import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Dimensions, Animated, ScrollView, Alert } from 'react-native';
import { Video } from 'expo-av';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../utils/supabase';
import ActionStack from './ActionStack';
import CommentsModal from './CommentsModal';

const { height, width } = Dimensions.get('window');

// Utility function to format numbers (e.g., 12345 -> 12.3K)
const formatCount = (num) => {
  if (num === null || num === undefined) return '0';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};

function VideoCard({ item, index, currentVideoIndex, navigation }) {
  // Defensive check for 'item' prop
  if (!item) {
    console.error('VideoCard: Missing required prop "item".');
    return null;
  }

  const videoRef = useRef(null);
  const [heartScale] = useState(new Animated.Value(0)); // For double-tap heart animation
  const [currentUserId, setCurrentUserId] = useState(null);
  const [hasLiked, setHasLiked] = useState(false);
  const [localLikeCount, setLocalLikeCount] = useState(item.like_count || 0);
  const [localCommentCount, setLocalCommentCount] = useState(item.comment_count || 0); // To update comment count in UI
  const [isCommentsModalVisible, setIsCommentsModalVisible] = useState(false); // State for modal visibility

  // 1. Fetch current user ID on component mount
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setCurrentUserId(user.id);
        }
      } catch (error) {
        console.error('Error fetching user:', error.message);
      }
    };
    fetchUser();
  }, []);

  // 2. Fetch user's like status for this post
  const fetchUserLikeStatus = useCallback(async () => {
    if (!currentUserId || !item.id) return;
    try {
      const { data, error } = await supabase
        .from('post_likes')
        .select('id')
        .eq('user_id', currentUserId)
        .eq('post_id', item.id)
        .single();
      if (error && error.code !== 'PGRST116') { // PGRST116 means "No rows found"
        console.error('Error fetching like status:', error.message);
      } else {
        setHasLiked(!!data); // Convert data (or null) to boolean
      }
    } catch (error) {
      console.error('Exception fetching like status:', error.message);
    }
  }, [currentUserId, item.id]);

  useEffect(() => {
    if (currentUserId) {
      fetchUserLikeStatus();
    }
  }, [currentUserId, fetchUserLikeStatus]);

  // 3. Real-time Listener for Comments (from original version, adapted)
  useEffect(() => {
    // Only subscribe if item.id is available
    if (!item.id) return;

    const commentsChannel = supabase
      .channel(`public:comments:${item.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${item.id}` },
        payload => {
          // A new comment was inserted for this post, update the count
          setLocalCommentCount(prev => prev + 1);
          // If you need to refresh comments in the modal, you'd trigger a fetch there
          // or pass the new comment payload to the modal if it's open.
        }
      )
      .subscribe((status, err) => {
        if (err) console.error('Supabase comments subscription error:', err.message);
      });

    // Clean up subscription on component unmount or item.id change
    return () => {
      supabase.removeChannel(commentsChannel);
    };
  }, [item.id]);


  // 4. Video playback control (Auto-play/pause based on visibility)
  useEffect(() => {
    if (videoRef.current) {
      if (index === currentVideoIndex) {
        videoRef.current.playAsync().catch((e) => console.error('Video play error:', e));
      } else {
        videoRef.current.pauseAsync().catch((e) => console.error('Video pause error:', e));
      }
    }
  }, [index, currentVideoIndex]);

  // 5. Pause video when screen loses focus (navigation stack changes)
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (videoRef.current) {
          videoRef.current.pauseAsync().catch((e) => console.error('Focus effect pause error:', e));
        }
      };
    }, [])
  );

  // 6. Double-tap heart animation
  const animateHeart = () => {
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1, friction: 2, tension: 40, useNativeDriver: true }),
      Animated.spring(heartScale, { toValue: 0, friction: 2, tension: 40, useNativeDriver: true, delay: 500 }),
    ]).start();
  };

  // 7. Handle liking/unliking a post (called by double tap and action bar)
  const handleLike = async () => {
    if (!currentUserId) {
      Alert.alert('Login Required', 'Please log in to like posts.');
      return;
    }
    // Optimistic UI update
    setHasLiked(prev => !prev);
    setLocalLikeCount(prevCount => prevCount + (hasLiked ? -1 : 1));

    try {
      if (hasLiked) {
        // Unlike the post
        const { error } = await supabase
          .from('post_likes')
          .delete()
          .eq('user_id', currentUserId)
          .eq('post_id', item.id);
        if (error) {
          console.error('Error unliking post:', error.message);
          Alert.alert('Error', 'Failed to unlike post. Please try again.');
          // Revert optimistic update
          setHasLiked(prev => !prev);
          setLocalLikeCount(prevCount => prevCount + 1);
        }
      } else {
        // Like the post
        const { error } = await supabase
          .from('post_likes')
          .insert({ user_id: currentUserId, post_id: item.id });
        if (error) {
          console.error('Error liking post:', error.message);
          Alert.alert('Error', 'Failed to like post. Please try again.');
          // Revert optimistic update
          setHasLiked(prev => !prev);
          setLocalLikeCount(prevCount => prevCount - 1);
        }
      }
    } catch (error) {
      console.error('Exception during like/unlike:', error.message);
      Alert.alert('Error', 'An unexpected error occurred.');
      // Revert optimistic update
      setHasLiked(prev => !prev);
      setLocalLikeCount(prevCount => prev + (hasLiked ? 1 : -1));
    }
  };

  // 8. Handle double tap on video to like
  const handleDoubleTap = () => {
    // Only allow double tap if comments modal is not visible
    if (!isCommentsModalVisible) {
      animateHeart();
      // Trigger like action on double tap if not already liked
      if (!hasLiked) {
        handleLike();
      }
    }
  };

  // 9. Handle comment button press (opens modal)
  const handleComment = () => {
    setIsCommentsModalVisible(true); // Show the comments modal
  };

  // 10. Handle share button press
  const handleShare = () => {
    console.log(`Share post: ${item.id}`);
    Alert.alert('Share', 'This would open the share options for the post.');
    // Here you would typically use a sharing API like Share.share from react-native
  };

  return (
    <TouchableOpacity activeOpacity={1} onPress={handleDoubleTap} style={styles.videoContainer}>
      <Video
        ref={videoRef}
        source={{ uri: item.media_url }}
        style={styles.videoPlayer}
        resizeMode="cover"
        isLooping
        shouldPlay={false} // Playback controlled by useEffect based on currentVideoIndex
      />

      {/* Overlay for text and actions */}
      <View style={styles.overlayContainer}>
        {/* Left side: Username and Caption */}
        <View style={styles.leftContent}>
          {item.profiles?.username && (
            <Text style={styles.usernameText}>
              @{item.profiles.username}
            </Text>
          )}
          {item.content ? (
            <ScrollView style={styles.captionScrollView} showsVerticalScrollIndicator={false}>
              <Text style={styles.captionText}>{item.content}</Text>
            </ScrollView>
          ) : null}
        </View>

        {/* Action Bar (Right side) */}
        <ActionStack
          likeCount={formatCount(localLikeCount)}
          commentCount={formatCount(localCommentCount)} // Pass localCommentCount
          shareCount={formatCount(0)} // Assuming share count is not tracked or always 0 for now
          onLikePress={handleLike}
          onCommentPress={handleComment}
          onSharePress={handleShare}
          isLiked={hasLiked}
        />
      </View>

      {/* Avatar (positioned absolutely) */}
      {item.profiles?.avatar_url && (
        <Image source={{ uri: item.profiles.avatar_url }} style={styles.avatar} />
      )}

      {/* Animated Heart Overlay (shows on double tap) */}
      <Animated.View style={[styles.animatedHeart, { opacity: heartScale, transform: [{ scale: heartScale }] }]}>
        {/* You need to import HeartIcon if it's used directly here */}
        <Image source={require('../assets/icons/heart.png')} style={{ width: 100, height: 100, tintColor: 'white' }} />
      </Animated.View>

      {/* Comments Modal */}
      <CommentsModal
        isVisible={isCommentsModalVisible}
        onClose={() => setIsCommentsModalVisible(false)}
        postId={item.id}
        // Pass localCommentCount if CommentsModal needs to display initial count,
        // but CommentsModal should ideally manage its own comment list and count internally.
        postCommentCount={localCommentCount}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  videoContainer: {
    height: height,
    width: width, // Ensure it takes full width
    backgroundColor: '#000', // Fallback background
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
  },
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end', // Aligns content to the bottom
    paddingHorizontal: 15,
    paddingBottom: 150, // Space for the bottom nav bar + ActionStack
    flexDirection: 'row', // To position left and right content
    alignItems: 'flex-end', // Align items to the bottom of the container
  },
  leftContent: {
    flex: 1, // Takes up remaining space
    justifyContent: 'flex-end', // Aligns content to bottom of its own container
    marginRight: 10, // Space between left content and action bar
    paddingBottom: 10, // Padding from the very bottom of the overlay container
  },
  usernameText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 5,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10,
  },
  captionScrollView: {
    maxHeight: height * 0.15, // Adjusted max height for caption to fit comfortably
  },
  captionText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10,
  },
  avatar: {
    position: 'absolute',
    right: 12,
    top: height * 0.45, // Position relative to screen height
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#00BFFF',
    backgroundColor: '#333',
    zIndex: 1,
  },
  animatedHeart: {
    position: 'absolute',
    left: '50%', // Start from 50% from the left
    top: '50%',  // Start from 50% from the top
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    // Use transform to precisely center the heart based on its own dimensions
    transform: [{ translateX: -50 }, { translateY: -50 }],
  },
});

export default VideoCard;