import React, { createContext, useContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { themeColors } from "./constants/theme"; // 確保路徑對齊你的 theme.js
export const AVATARS = {
  avatar1: require("../assets/avatar1.png"),
  avatar2: require("../assets/avatar2.png"),
  avatar3: require("../assets/avatar3.png"),
};
const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [themeMode, setThemeMode] = useState("light"); // 'light' 或 'dark'
  const [currentAvatarId, setCurrentAvatarId] = useState("avatar1");
  const [isThemeReady, setIsThemeReady] = useState(false);

  // 🎯 從 AsyncStorage 載入持久化的主題設定
  useEffect(() => {
    const loadThemeFromStorage = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem("app_theme_mode");
        const savedAvatar = await AsyncStorage.getItem("app_avatar_id");
        
        if (savedTheme) {
          setThemeMode(savedTheme);
        }
        if (savedAvatar && AVATARS[savedAvatar]) {
          setCurrentAvatarId(savedAvatar);
        }
      } catch (error) {
        console.warn("Failed to load theme from storage:", error);
      } finally {
        setIsThemeReady(true);
      }
    };

    loadThemeFromStorage();
  }, []);

  const toggleTheme = async () => {
    const newTheme = themeMode === "light" ? "dark" : "light";
    setThemeMode(newTheme);
    // 🎯 同步儲存到 AsyncStorage
    try {
      await AsyncStorage.setItem("app_theme_mode", newTheme);
    } catch (error) {
      console.warn("Failed to save theme:", error);
    }
  };

  // 🎯 新增：登出時強制重置為淺色模式
  const resetThemeToLight = async () => {
    setThemeMode("light");
    try {
      await AsyncStorage.setItem("app_theme_mode", "light");
    } catch (error) {
      console.warn("Failed to reset theme:", error);
    }
  };

  const changeAvatar = async (avatarId) => {
    if (AVATARS[avatarId]) {
      setCurrentAvatarId(avatarId);
      // 🎯 同步儲存到 AsyncStorage
      try {
        await AsyncStorage.setItem("app_avatar_id", avatarId);
      } catch (error) {
        console.warn("Failed to save avatar:", error);
      }
    }
  };

  const colors = themeColors[themeMode];

  if (!isThemeReady) {
    return null; // 等待主題載入完成
  }

  return (
    <ThemeContext.Provider 
      value={{ 
        themeMode, 
        colors, 
        toggleTheme,
        resetThemeToLight, // 🎯 新增：供登出時調用
        
        // 🎯 4. 完美融合：把頭像的狀態與控制功能塞進 Provider 給全 App 訂閱
        currentAvatarId,                  // 當前頭像的字串 ID（例如 'avatar1'）
        currentAvatarSource: AVATARS[currentAvatarId], // 直接回傳 require 圖片資產，可直接塞給 Image source
        changeAvatar,                     // 呼叫變換頭像的動作
        allAvatars: AVATARS,              // 釋放整張頭像表，供個人頁面選單渲染使用
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}