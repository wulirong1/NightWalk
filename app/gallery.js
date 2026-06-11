import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "./ThemeContext";
import { colors, fontSizes } from "./constants/theme";

const images = [
  require("../assets/1.png"),
  require("../assets/2.png"),
  require("../assets/3.png"),
  require("../assets/4.png"),
  require("../assets/5.png"),
  require("../assets/6.png"),
];

export default function GalleryPage() {
  const { themeMode, colors: themeColors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const screenWidth = Dimensions.get("window").width;

  const handleScroll = (event) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const viewWidth = event.nativeEvent.layoutMeasurement.width;
    if (viewWidth > 0) {
      const currentIdx = Math.floor(contentOffsetX / viewWidth + 0.5);
      const clampedIdx = Math.max(0, Math.min(currentIdx, images.length - 1));
      setCurrentIndex(clampedIdx);
    }
  };

  const renderImage = ({ item }) => (
    <View style={styles.imageContainer}>
      <Image
        source={item}
        style={styles.image}
        resizeMode="contain"
      />
    </View>
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: themeColors.background, paddingTop: insets.top },
      ]}
    >
      <StatusBar
        barStyle={themeMode === "dark" ? "light-content" : "dark-content"}
        backgroundColor={themeColors.background}
      />

      {/* 頂部標題欄 */}
      <View
        style={[
          styles.header,
          {
            borderBottomColor:
              themeMode === "dark" ? "#2C2C2C" : "#EDEDED",
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityLabel="返回"
          accessibilityRole="button"
        >
          <Text style={[styles.backText, { color: themeColors.text }]}>❮</Text>
        </Pressable>
        <Text style={[styles.title, { color: themeColors.text }]}>App 導覽</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* 中央內容區域 */}
      <View style={styles.centerContent}>
        {/* 圖片卡片 */}
        <FlatList
          ref={flatListRef}
          data={images}
          renderItem={renderImage}
          keyExtractor={(_, index) => `image-${index}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
          initialScrollIndex={0}
          getItemLayout={(data, index) => (
            {
              length: screenWidth,
              offset: screenWidth * index,
              index,
            }
          )}
        />

        {/* 分頁指示器 */}
        <View style={styles.dotsContainer}>
          {images.map((_, index) => (
            <View
              key={`dot-${index}`}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    index === currentIndex
                      ? themeColors.special
                      : themeMode === "dark"
                        ? "#444444"
                        : "#CCCCCC",
                },
              ]}
            />
          ))}
        </View>

        {/* 計數器 */}
        <Text
          style={[
            styles.counter,
            {
              color: themeMode === "dark" ? "#AAAAAA" : "#777777",
              marginBottom: insets.bottom + 15,
            },
          ]}
        >
          {currentIndex + 1} / {images.length}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#EDEDED",
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: {
    fontSize: fontSizes.titleLarge,
    fontWeight: "bold",
  },
  title: {
    fontSize: fontSizes.titleLarge,
    fontWeight: "bold",
  },
  imageContainer: {
    width: Dimensions.get("window").width,
    justifyContent: "center",
    alignItems: "center",
  },
  image: {
    width: "90%",
    height: "90%",
    aspectRatio: 1,
  },
  dotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 8,
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  counter: {
    textAlign: "center",
    fontSize: fontSizes.bodySmall,
    marginBottom: 10,
  },
});
