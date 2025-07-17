// screens/FeedScreen.js

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { FlatList, ActivityIndicator, Dimensions, StyleSheet, View } from 'react-native'; // Import View
import { supabase } from '../utils/supabase';
import VideoCard from '../components/VideoCard';
import { useNavigation } from '@react-navigation/native';

const { height } = Dimensions.get('window');

function FeedScreen() {
  const navigation = useNavigation();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);

  useEffect(() => {
    const fetchVideos = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('posts')
        .select(`
          id,
          media_url,
          content,
          like_count,
          comment_count,
          view_count,
          author_id,
          profiles (
            username,
            avatar_url
          )
        `)
        .eq('file_type', 'video')
        .order('created_at', { ascending: false });

      if (!error) {
        // Ensure data is not null and does not contain null/undefined items
        setVideos(data ? data.filter(item => item !== null && item.id) : []); // Added filter for robustness
      } else {
        console.error("Error fetching feed videos:", error.message);
      }
      setLoading(false);
    };
    fetchVideos();
  }, []);

  const onViewableItemsChanged = useCallback(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      // Ensure the index is valid before setting state
      const firstVisibleIndex = viewableItems[0].index;
      if (firstVisibleIndex !== undefined && firstVisibleIndex !== null) {
        setCurrentVideoIndex(firstVisibleIndex);
      }
    }
  }, []);

  // Define viewabilityConfig in a useRef to prevent re-creation on every render
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 80, // Keep your threshold
    // You can add throttle or debounce if needed for very rapid scrolling
  }).current;

  if (loading) {
    return <ActivityIndicator size="large" color="#00BFFF" style={styles.loadingIndicator} />;
  }

  // Handle case where no videos are fetched
  if (videos.length === 0 && !loading) {
    return (
      <View style={styles.noVideosContainer}>
        <Text style={styles.noVideosText}>No videos to display yet.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={videos}
      keyExtractor={item => item.id.toString()} // Ensure key is a string
      pagingEnabled // Enables snap-to-page behavior
      snapToInterval={height} // Snaps to the full height of the screen
      decelerationRate="fast" // Faster deceleration for snapping
      showsVerticalScrollIndicator={false}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      // CRUCIAL FOR VIDEO PLAYBACK STABILITY:
      windowSize={21} // Keep many items mounted (e.g., 10 above, 10 below, plus current)
      removeClippedSubviews={false} // Prevents aggressive unmounting of off-screen components
      renderItem={({ item, index }) => (
        <VideoCard
          item={item}
          index={index}
          currentVideoIndex={currentVideoIndex}
          navigation={navigation}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  loadingIndicator: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  noVideosContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  noVideosText: {
    color: '#FFF',
    fontSize: 18,
  },
});

export default FeedScreen;