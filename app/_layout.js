import { useEffect, useState } from "react";
import { Stack, usePathname } from "expo-router";
import { StatusBar, StyleSheet, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import BottomNavigation from "./components/BottomNavigation";
import { ThemeProvider, useTheme } from "./ThemeContext"; // 🎯 1. 引入你的全域主題管家（請根據真實路徑微調）
import { authReady } from "../firebase";

export default function RootLayout() {
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    authReady
      .catch(() => null)
      .finally(() => {
        if (isMounted) {
          setIsAuthReady(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (!isAuthReady) {
    return null;
  }

  return (
    // 🎯 2. ThemeProvider 必須放在最頂層，包住所有 Provider
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <KeyboardProvider statusBarTranslucent>
          <AppFrame />
        </KeyboardProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

function AppFrame() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  
  // 🎯 3. 從全域主題中撈出「動態顏色」與「目前模式」
  const { themeMode, colors } = useTheme();

  const showNavigation =
    pathname === "/" ||
    pathname === "/Add" ||
    pathname === "/Account" ||
    pathname === "/Login";

  return (
    <>
      {/* 🎯 4. 狀態列文字顏色連動：白天用暗色字 (dark-content)，夜間用亮色字 (light-content) */}
      <StatusBar
        translucent
        barStyle={themeMode === "dark" ? "light-content" : "dark-content"}
        backgroundColor={colors.transparent}
      />
      
      {/* 🎯 5. 這裡最關鍵！最外層 View 的背景色必須動態跟隨 colors.background */}
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: "none",
            contentStyle: { backgroundColor: colors.background },
            gestureEnabled: false,
          }}
        />
      </View>

      {showNavigation ? (
        <View
          style={[
            styles.navigation,
            { 
              paddingBottom: Math.max(insets.bottom, 26),
              backgroundColor: colors.transparent // 🎯 連動透明度或底色
            },
          ]}
        >
          <BottomNavigation />
        </View>
      ) : null}
    </>
  );
}

// 🎯 6. 這裡原本靜態 import 的 colors 拿掉，StyleSheet 只留結構
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    // 這裡本來的 backgroundColor 移到上面用陣列動態注入了
  },
  navigation: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    elevation: 20,
  },
});
