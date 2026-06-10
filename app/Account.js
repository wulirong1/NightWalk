const settingsIcon = require("../assets/settings.png"); 
const nightModeIcon = require("../assets/Moon.png");
const accountCircle = require("../assets/account_circle.png");
const messageSquare = require("../assets/Messagesquare.png"); 
const mailIcon = require("../assets/Mail2.png");
const compassIcon = require("../assets/Compass.png");
const typeIcon = require("../assets/Type.png");
const clockIcon = require("../assets/Clock.png");
const thumbsUpIcon = require("../assets/ThumbsUp.png");
const thumbsUpDarkIcon = require("../assets/ThumbUp-on.png");
const pencilIcon = require("../assets/pencil.png");

import { useTheme } from "./ThemeContext"; // 🎯 1. 引入全域主題鉤子

import { useCallback, useEffect, useRef, useState } from "react"; // 1. 確保有引入 useEffect 和 useState
import {
  Animated,
  StatusBar,
  StyleSheet,
  Text,
  View,
  Pressable,
  FlatList,
  RefreshControl,
  Switch,
  Alert,
  Image,
  Keyboard,
  PanResponder,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { onAuthStateChanged, signOut, deleteUser, updateProfile } from "firebase/auth";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// 2. 引入 Firestore 相關語法
import { collection, query, where, orderBy, onSnapshot, collectionGroup, deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

import { auth, db } from "../firebase"; // 3. 確保引入了 db (Firestore 實例)
import { voteOnReport } from "../services/reportVoting";
import { colors, fontSizes } from "./constants/theme";

const historyDeleteActionWidth = 76;
const presetDangerTypeLabels = {
  theft: "偷竊",
  harass: "騷擾",
  track: "跟蹤",
};

function formatDangerType(type) {
  if (typeof type !== "string") return "#未分類";

  const presetLabel = presetDangerTypeLabels[type];
  if (presetLabel) return `#${presetLabel}`;

  const label = type
    .replace(/^(?:custom:)+/i, "")
    .replace(/^:+/, "")
    .replace(/^(?:#|＃)+/, "")
    .trim();

  return `#${label || "未分類"}`;
}

function formatHistoryDate(createdAt) {
  const date = typeof createdAt?.toDate === "function"
    ? createdAt.toDate()
    : createdAt?.seconds
      ? new Date(createdAt.seconds * 1000)
      : null;

  if (!date || Number.isNaN(date.getTime())) return "近期";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function SwipeToDelete({ children, onDelete, surfaceColor, actionLabel = "刪除" }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isDeleteActionOpenRef = useRef(false);
  const dragStartXRef = useRef(0);

  const animateTo = useCallback((toValue) => {
    isDeleteActionOpenRef.current = toValue !== 0;
    Animated.spring(translateX, {
      toValue,
      friction: 8,
      tension: 100,
      useNativeDriver: true,
    }).start();
  }, [translateX]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        const isHorizontalSwipe =
          Math.abs(gestureState.dx) > 12 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5;

        return (
          isHorizontalSwipe &&
          (gestureState.dx < 0 || isDeleteActionOpenRef.current)
        );
      },
      onPanResponderGrant: () => {
        dragStartXRef.current = isDeleteActionOpenRef.current ? -historyDeleteActionWidth : 0;
      },
      onPanResponderMove: (_, gestureState) => {
        const nextTranslateX = Math.max(
          -historyDeleteActionWidth,
          Math.min(0, dragStartXRef.current + gestureState.dx)
        );
        translateX.setValue(nextTranslateX);
      },
      onPanResponderRelease: (_, gestureState) => {
        const nextTranslateX = dragStartXRef.current + gestureState.dx;
        animateTo(nextTranslateX < -historyDeleteActionWidth / 2 ? -historyDeleteActionWidth : 0);
      },
      onPanResponderTerminate: () => {
        animateTo(isDeleteActionOpenRef.current ? -historyDeleteActionWidth : 0);
      },
      onPanResponderTerminationRequest: (_, gestureState) =>
        Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
      onShouldBlockNativeResponder: () => false,
    })
  ).current;

  return (
    <View style={[styles.historySwipeContainer, { backgroundColor: surfaceColor }]}>
      <Pressable
        accessibilityLabel={`${actionLabel}紀錄`}
        accessibilityRole="button"
        onPress={onDelete}
        style={styles.historyDeleteButton}
      >
        <Text style={styles.historyDeleteText}>{actionLabel}</Text>
      </Pressable>
      <Animated.View
        {...panResponder.panHandlers}
        style={{ transform: [{ translateX }] }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

export default function AccountPage() {
  // 🎯 修改：加入 currentAvatarSource（圖片資產）與 changeAvatar（變換函式）
  const { themeMode, colors, toggleTheme, currentAvatarSource, changeAvatar, currentAvatarId,allAvatars } = useTheme();
  const [currentView, setCurrentView] = useState("profile"); // "profile" 或 "settings"
  const [showAvatarPicker, setShowAvatarPicker] = useState(false); // 控制頭像選單
  const [isDarkMode, setIsDarkMode] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState(auth.currentUser);
  const [displayName, setDisplayName] = useState(auth.currentUser?.displayName || "");
  const [nameDraft, setNameDraft] = useState(auth.currentUser?.displayName || "");
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  
  // 🎯 建立儲存 Firebase 資料的 State（取代原本的模擬資料）
  const [historyData, setHistoryData] = useState([]);
  const [userStats, setUserStats] = useState({ reports: 0, likes: 0 });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);

  

  // 檢查登入狀態
  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setDisplayName(user?.displayName || "");
      setNameDraft(user?.displayName || "");
      setAuthChecked(true);

      if (!user) {
        router.replace("/Login");
      }
    });
  }, [router]);

  // 監聽回報與評論的大合體
  useEffect(() => {
    if (!currentUser) return;

    let reportsData = [];
    let commentsData = [];
    let likedReportsData = [];
    let reportsLoaded = false;
    let commentsLoaded = false;
    let likedReportsLoaded = false;
    let likedReportsRequestId = 0;
    let isActive = true;

    const finishRefreshIfReady = () => {
      if (reportsLoaded && commentsLoaded && likedReportsLoaded) {
        setIsRefreshing(false);
      }
    };

    // 🎯 歷史紀錄大合體的更新函式
    const updateHistoryList = () => {
      // 把兩邊撈到的資料揉成一個陣列，並加上 type 標記方便 renderItem 識別
      const combined = [
        ...reportsData.map(item => ({ ...item, listType: "report" })),
        ...commentsData.map(item => ({ ...item, listType: "comment" })),
        ...likedReportsData.map(item => ({ ...item, listType: "liked" }))
      ];

      // 依據時間 (createdAt) 從新到舊排序
      combined.sort((a, b) => {
        const timeA = a.createdAt?.seconds || 0;
        const timeB = b.createdAt?.seconds || 0;
        return timeB - timeA;
      });

      setHistoryData(combined);

      const totalLikes = reportsData.reduce((sum, item) => {
        return sum + (item.credibleCount || 0);
      }, 0);
      // 自動更新數據看板中的「總回報數」
      setUserStats((prev) => ({
        ...prev,
        reports: reportsData.length,
        likes: totalLikes,           // 🎯 讓這邊動起來！反映即時加總的讚數
      }));
    };

    // ─── 監聽 1：使用者發布的「回報」 ───
    const reportsQuery = query(
      collection(db, "reports"),
      where("userId", "==", currentUser.uid),
      orderBy("createdAt", "desc")
    );
    const unsubscribeReports = onSnapshot(reportsQuery, (snapshot) => {
      reportsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      reportsLoaded = true;
      updateHistoryList();
      finishRefreshIfReady();
    }, (error) => {
      reportsLoaded = true;
      finishRefreshIfReady();
      console.error("讀取回報失敗:", error);
    });

    // ─── 監聽 2：跨貼文監聽使用者寫過的「評論」 ───
    // 💡 這裡會去撈取所有 reports/*/comments 底下 userId 等於目前登入者的資料
    const commentsQuery = query(
      collectionGroup(db, "comments"),
      where("userId", "==", currentUser.uid)
    );
    const unsubscribeComments = onSnapshot(commentsQuery, (snapshot) => {
      commentsData = snapshot.docs.map(doc => {
        const data = doc.data();
        const reportSnapshot = doc.ref.parent.parent; // 找到父貼文的參照
        const reportId = doc.ref.parent.parent?.id || ""; 
        return { id: doc.id, reportId, 
          locationText: data.locationText || "未知名稱",
          ...data };
      });
      commentsLoaded = true;
      updateHistoryList();
      finishRefreshIfReady();
    }, (error) => {
      commentsLoaded = true;
      finishRefreshIfReady();
      console.error("讀取評論失敗，可能需要建立 Index 索引:", error);
    });

    // ─── 監聽 3：讀取所有回報，再檢查目前使用者按過「可信」的項目 ───
    const unsubscribeLikedReports = onSnapshot(collection(db, "reports"), async (snapshot) => {
      const requestId = ++likedReportsRequestId;

      try {
        const likedReports = await Promise.all(
          snapshot.docs.map(async (reportSnapshot) => {
            const voteSnapshot = await getDoc(
              doc(db, "reports", reportSnapshot.id, "votes", currentUser.uid)
            );

            if (!voteSnapshot.exists() || voteSnapshot.data().vote !== "credible") {
              return null;
            }

            return {
              id: reportSnapshot.id,
              reportId: reportSnapshot.id,
              ...reportSnapshot.data(),
              createdAt: voteSnapshot.data().updatedAt || reportSnapshot.data().createdAt,
            };
          })
        );

        if (!isActive || requestId !== likedReportsRequestId) return;
        likedReportsData = likedReports.filter(Boolean);
        likedReportsLoaded = true;
        updateHistoryList();
        finishRefreshIfReady();
      } catch (error) {
        if (!isActive || requestId !== likedReportsRequestId) return;
        likedReportsLoaded = true;
        finishRefreshIfReady();
        console.error("讀取按讚回報失敗:", error);
      }
    }, (error) => {
      likedReportsLoaded = true;
      finishRefreshIfReady();
      console.error("監聽按讚回報失敗:", error);
    });

    // 組件卸載時，把三個即時監聽都關掉
    return () => {
      isActive = false;
      unsubscribeReports();
      unsubscribeComments();
      unsubscribeLikedReports();
    };
  }, [currentUser, refreshCount]);

  function handleRefresh() {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setRefreshCount((currentCount) => currentCount + 1);
  }

  async function handleSignOut() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("登出失敗:", error);
      Alert.alert("登出失敗", "目前無法登出，請稍後再試。");
    }
  }

  async function handleSaveDisplayName() {
    const nextDisplayName = nameDraft.trim();
    if (!nextDisplayName || isSavingName || !currentUser) {
      if (!nextDisplayName) {
        Alert.alert("名稱不能為空白", "請輸入使用者名稱。");
      }
      return;
    }

    if (nextDisplayName === displayName) {
      setIsEditingName(false);
      return;
    }

    setIsSavingName(true);
    try {
      await updateProfile(currentUser, { displayName: nextDisplayName });
      setDisplayName(nextDisplayName);
      setNameDraft(nextDisplayName);
      setIsEditingName(false);

      try {
        await setDoc(
          doc(db, "users", currentUser.uid),
          {
            nickname: nextDisplayName,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (profileError) {
        console.warn("同步 Firestore 使用者名稱失敗:", profileError);
      }
    } catch (error) {
      console.error("更新使用者名稱失敗:", error);
      Alert.alert("更新失敗", "目前無法修改使用者名稱，請稍後再試。");
    } finally {
      setIsSavingName(false);
    }
  }

  function handleDeleteHistoryItem(item) {
    const isReport = item.listType === "report";
    const isLiked = item.listType === "liked";
    const title = isReport ? "刪除回報" : isLiked ? "刪除按讚" : "刪除留言";
    const message = isReport
      ? "確定要刪除這筆回報嗎？刪除後將無法復原。"
      : isLiked
        ? "確定刪除按讚"
        : "確定要刪除這則留言嗎？刪除後將無法復原。";

    Alert.alert(title, message, [
      { text: "取消", style: "cancel" },
      {
        text: isLiked ? "刪除按讚" : "確定刪除",
        style: "destructive",
        onPress: async () => {
          try {
            if (isReport) {
              await deleteDoc(doc(db, "reports", item.id));
            } else if (isLiked && item.reportId) {
              await voteOnReport(item.reportId, "credible");
            } else if (item.reportId) {
              await deleteDoc(doc(db, "reports", item.reportId, "comments", item.id));
            } else {
              Alert.alert("刪除失敗", "找不到這則留言所屬的回報。");
            }
          } catch (error) {
            const actionLabel = isReport ? "回報" : isLiked ? "按讚" : "留言";
            console.error(`${isLiked ? "取消" : "刪除"}${actionLabel}失敗:`, error);
            Alert.alert(
              isLiked ? "取消按讚失敗" : "刪除失敗",
              `目前無法${isLiked ? "取消" : "刪除"}${actionLabel}，請稍後再試。`
            );
          }
        },
      },
    ]);
  }

  const renderItem = ({ item }) => {
    const isReport = item.listType === "report";
    const isLiked = item.listType === "liked";
    const isReportCard = isReport || isLiked;
    const surfaceColor = themeMode === "dark" ? "#1E1E1E" : "#FFFFFF";

    return (
      <SwipeToDelete
        onDelete={() => handleDeleteHistoryItem(item)}
        surfaceColor={surfaceColor}
        actionLabel="刪除"
      >
        <Pressable
          // 🎯 修正：卡片背景色跟隨 colors.surfaceMuted（暗色時變深灰），消除原本寫死的 #FFFFFF
          style={[styles.card, { backgroundColor: surfaceColor }]}
          onPress={() => {
            const targetReportId = isReport ? item.id : item.reportId;
            if (targetReportId) {
              router.push({ pathname: "/detail", params: { reportId: targetReportId } });
            } else {
              Alert.alert("提示", "無法追蹤該資料的原始回報頁面。");
            }
          }}
        >

          <View style={styles.cardLeft}>
            <Image
              source={
                isLiked
                  ? (themeMode === "dark" ? thumbsUpDarkIcon : thumbsUpIcon)
                  : isReport
                    ? mailIcon
                    : messageSquare
              }
              style={[
                styles.cardItemIcon,
                !isLiked && { tintColor: colors.text }
              ]}
            />
            <Text style={[styles.cardTypeText, { color: themeMode === "dark" ? "#AAAAAA" : "#777777", marginTop: 4 }]}>
              {isReport ? "回報" : isLiked ? "按讚" : "評論"}
            </Text>
          </View>

          <View style={styles.cardMiddle}>
            {isReportCard ? (
              <>
                {/* 🎯 修正：標題文字顏色跟隨 colors.text */}
                <Text style={[styles.cardTitle, { color: colors.text }]}>{item.locationText || "未知名稱"}</Text>

                <View style={styles.tagWrapper}>
                  {(item.types?.length ? item.types : ["一般"]).map((type, index) => (
                    <View
                      key={`${type}-${index}`}
                      style={[styles.grayTag, { backgroundColor: themeMode === "dark" ? "#333333" : "#EDEDED" }]}
                    >
                      <Text style={[styles.grayTagText, { color: themeMode === "dark" ? "#DDDDDD" : "#555555" }]}>
                        {formatDangerType(type)}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>
                  {item.message || "空白內容"}
                </Text>
                <Text style={[styles.cardSubText, { color: themeMode === "dark" ? "#AAAAAA" : "#888888" }]} numberOfLines={1}>
                  {item.locationText || "未知名稱"}
                </Text>
              </>
            )}

            <View style={styles.timeRow}>
              <Image
                source={clockIcon}
                style={[
                  styles.timeIcon,
                  // 🎯 修正：時鐘圖示 tintColor 跟隨 colors.textMuted
                  { tintColor: themeMode === "dark" ? "#AAAAAA" : "#888888" }
                ]}
              />
              <Text style={[styles.cardSubText, { color: themeMode === "dark" ? "#AAAAAA" : "#888888" }]}>
                {formatHistoryDate(item.createdAt)}
              </Text>
            </View>
          </View>

          <View style={styles.cardRight}>
            <Text style={styles.arrow}>❯</Text>
          </View>
        </Pressable>
      </SwipeToDelete>
    );
  };
  if (!authChecked || !currentUser) {
    return <View style={styles.screen} />;
  }

 if (currentView === "settings") {
    return (
      <Pressable
        accessible={false}
        onPress={Keyboard.dismiss}
        style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}
      >
        <StatusBar barStyle={themeMode === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.background} />

        {/* 頂部導航 */}
        <View style={styles.settingsHeader}>
          <Pressable onPress={() => setCurrentView("profile")} style={{ padding: 8 }}>
            <Text style={{ fontSize: fontSizes.titleLarge, fontWeight: "bold", color: colors.text }}>❮</Text>            
          </Pressable>
          <Text style={{ fontSize: fontSizes.titleLarge, fontWeight: "bold", color: colors.text }}>設定</Text>          
          <View style={{ width: 32 }} />
        </View>
{/* 大頭貼與點擊多一層選單 */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarPlaceholderLarge}>
            <Image source={currentAvatarSource} style={styles.avatarImage} />
          </View>
          
          {/* 🎯 2. 點擊編輯頭像：切換開關狀態，讓下面的圖片選單展開或收合 */}
          <Pressable onPress={() => setShowAvatarPicker(!showAvatarPicker)}>
            <Text style={[styles.editAvatarText, { color: showAvatarPicker ? "#A3B7AC" : colors.text }]}>
              {showAvatarPicker ? "收起頭像選單 ▲" : "編輯頭像 ▼"}
            </Text>
          </Pressable>

          {/* 🎯 3. 多一層條件渲染：只有當 showAvatarPicker 為 true 時，三張圖片才會直觀顯示出來 */}
          {showAvatarPicker && (
            <View style={styles.avatarPickerRow}>
              {Object.keys(allAvatars).map((key) => {
                const isSelected = currentAvatarId === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => {
                      changeAvatar(key);
                      // 選完之後如果你希望自動收起來，可以把下面這行註解解開：
                      // setShowAvatarPicker(false);
                    }}
                    style={[
                      styles.avatarPickerItem,
                      { borderColor: isSelected ? "#A3B7AC" : "transparent" }
                    ]}
                  >
                    <Image source={allAvatars[key]} style={styles.avatarPickerImage} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {/* 基本資訊 */}
        {/* 🎯 修正：基本資訊標題文字動態綁定 colors.text */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>基本資訊</Text>
        <View style={[styles.cardGroup, { backgroundColor: themeMode === "dark" ? "#1E1E1E" : "#FFFFFF" }]}>          
          {/* 🎯 修正：橫列邊框色在夜間模式時自動換成深灰色分割線 */}
          <View style={[styles.row, { borderBottomColor: themeMode === "dark" ? "#2C2C2C" : "#F0F0F0" }]}>
            <View style={styles.rowLeft}>
              <Image source={typeIcon} style={[styles.rowItemIcon, { tintColor: colors.special }]} />
              {/* 🎯 修正：欄位名稱標籤文字改為 dynamic colors.text */}
              <Text style={[styles.rowLabel, { color: colors.text }]}>使用者名稱</Text>
            </View>
            {isEditingName ? (
              <View style={styles.nameEditContainer}>
                <TextInput
                  autoFocus
                  editable={!isSavingName}
                  maxLength={30}
                  onChangeText={setNameDraft}
                  onSubmitEditing={handleSaveDisplayName}
                  returnKeyType="done"
                  selectTextOnFocus
                  style={[
                    styles.nameInput,
                    {
                      color: colors.text,
                      borderColor: themeMode === "dark" ? "#444444" : "#DDDDDD",
                    },
                  ]}
                  value={nameDraft}
                />
                <Pressable
                  disabled={isSavingName}
                  hitSlop={8}
                  onPress={handleSaveDisplayName}
                >
                  <Text style={[styles.nameSaveText, { color: colors.special }]}>
                    {isSavingName ? "儲存中" : "儲存"}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                hitSlop={8}
                onPress={() => {
                  setNameDraft(displayName || currentUser.email?.split("@")[0] || "");
                  setIsEditingName(true);
                }}
                style={styles.nameDisplayButton}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.rowValue, { color: themeMode === "dark" ? "#AAAAAA" : "#777777" }]}
                >
                  {displayName || currentUser.email?.split("@")[0] || "夜行者__22"}
                </Text>
                <Image source={pencilIcon} style={styles.nameEditIcon} />
              </Pressable>
            )}
          </View>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <View style={styles.rowLeft}>
              <Image source={mailIcon} style={[styles.rowItemIcon, { tintColor: colors.special }]} />
              <Text style={[styles.rowLabel, { color: colors.text }]}>電子郵件</Text>
            </View>
            <Text style={[styles.rowValue, { color: themeMode === "dark" ? "#AAAAAA" : "#777777" }]} numberOfLines={1}>
              {currentUser.email || "xxxxxxx@gmail.com"}
            </Text>
          </View>
        </View>

        {/* 其他設定 */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>其他</Text>
        <View style={[styles.cardGroup, { backgroundColor: themeMode === "dark" ? "#1E1E1E" : "#FFFFFF" }]}>
          <View style={[styles.row, { borderBottomColor: themeMode === "dark" ? "#2C2C2C" : "#F0F0F0" }]}>
            <View style={styles.rowLeft}>
              {/* 🎯 修正：月亮 icon 點亮時是你們專屬莫蘭迪綠 (#A3B7AC)，關閉時動態跟隨主色調（白天黑/夜間白） */}
              <Image
                source={nightModeIcon}
                style={[
                  styles.rowItemIcon,
                  { tintColor: colors.special }
                ]}
              />
              <Text style={[styles.rowLabel, { color: colors.text }]}>夜間模式</Text>
            </View>
            <View style={styles.themeSwitchContainer}>
              <Switch
                trackColor={{ false: "#767577", true: colors.special }}
                thumbColor={themeMode === "dark" ? colors.white : "#f4f3f4"}
                onValueChange={toggleTheme}
                value={themeMode === "dark"}
              />
            </View>
          </View>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <View style={styles.rowLeft}>
              <Image source={compassIcon} style={[styles.rowItemIcon, { tintColor: colors.special }]} />
              <Text style={[styles.rowLabel, { color: colors.text }]}>App導覽</Text>
            </View>
            <Text style={[styles.arrow, { color: themeMode === "dark" ? "#666666" : "#CCCCCC" }]}>❯</Text>
          </View>
        </View>

        <View style={styles.buttonGroup}>
          <Pressable 
            style={[styles.logoutButton, { backgroundColor: themeMode === "dark" ? "#1E1E1E" : "#FFFFFF", borderColor: themeMode === "dark" ? "#2C2C2C" : "#E0E0E0" }]}
            onPress={() => {
              Alert.alert("登出帳號", "確定要登出嗎？", [
                { text: "取消", style: "cancel" },
                { text: "確定", style: "destructive", onPress: handleSignOut }
              ]);
            }}
          >
            <Text style={styles.logoutText}>登出</Text>
          </Pressable>

          <Pressable 
            style={styles.deleteButton} 
            onPress={() => {
              Alert.alert("危險操作", "您確定要刪除帳號嗎？此操作將無法復原。", [
                { text: "取消", style: "cancel" },
                { text: "確定刪除", style: "destructive", onPress: () => deleteUser(currentUser) }
              ]);
            }}
          >
            <Text style={styles.deleteText}>刪除帳號</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  }

  return (
<View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={themeMode === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.transparent} translucent />

      {/* 1. 頂部個人資訊 */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <View style={styles.userInfo}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="編輯頭像"
            hitSlop={12}
            onPress={() => setCurrentView("settings")}
            style={styles.avatarButton}
          >
          <View style={styles.avatarPlaceholder}>
            <Image source={currentAvatarSource} style={styles.avatarImage} />
          </View>
          </Pressable>
            <Text style={[styles.userName, { color: colors.text }]}>
            {displayName || currentUser.email?.split('@')[0] || "使用者名稱"}
          </Text>
        </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="設定"
            hitSlop={12}
            onPress={() => setCurrentView("settings")}
            style={styles.settingButton}
          >
          <Image
             source={settingsIcon}
              style={[
              styles.navIcon,
              { tintColor: colors.text }
        ]}
      />
          </Pressable>
      </View>

      {/* 2. 數據看板 */}
      <View style={styles.statsContainer}>
        <View style={styles.statBox}>
          {/* 顯示從 Firebase 計算出來的總數量 */}
          <Text style={styles.statNumber}>{userStats.reports}</Text>
          <Text style={styles.statLabel}>總回報數</Text>
        </View>
        <View style={styles.statCenterDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{userStats.likes}</Text>
          <Text style={styles.statLabel}>獲得讚數</Text>
        </View>
      </View>

      {/* 3. 歷史紀錄列表 */}
      <FlatList
        alwaysBounceVertical
        data={historyData}
        renderItem={renderItem}
        keyExtractor={(item) => `${item.listType}-${item.id}`}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.special}
            colors={[colors.special]}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}



const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 4,
  },
  userInfo: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarButton: {
    minWidth: 64,
    minHeight: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "transparent", 
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    resizeMode: "contain",
  },
  userName: {
    fontSize: fontSizes.titleLarge,
    fontWeight: "bold",
    marginLeft: 16,
  
  },
  settingButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  navIcon: {
    width: 28,
    height: 28,
    resizeMode: "contain",
  },
  statsContainer: {
    flexDirection: "row",
    backgroundColor: "#A3B7AC", // 圖片中的莫蘭迪綠
    marginHorizontal: 20,
    marginTop: 24,
    borderRadius: 12,
    height: 84,
    alignItems: "center",
    overflow: "hidden",
  },
  statBox: {
    width: "50%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  statCenterDivider: {
    position: "absolute",
    left: "50%",
    marginLeft: -0.5,
    width: 1,
    height: 44,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    zIndex: 1,
  },
  statNumber: {
    fontSize: fontSizes.heading,
    lineHeight: 30,
    fontWeight: "bold",
    color: "#FFFFFF",
    includeFontPadding: false,
    textAlign: "center",
  },
  statLabel: {
    fontSize: fontSizes.labelSmall,
    lineHeight: 18,
    color: "rgba(255, 255, 255, 0.8)",
    marginTop: 4,
    includeFontPadding: false,
    textAlign: "center",
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 130, 
  },
  historySwipeContainer: {
    position: "relative",
    borderRadius: 12,
    marginBottom: 12,
    overflow: "hidden",
    elevation: 2,
  },
  historyDeleteButton: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: historyDeleteActionWidth,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  historyDeleteText: {
    color: colors.white,
    fontSize: fontSizes.bodySmall,
    fontWeight: "900",
  },
  card: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardLeft: {
    alignItems: "center",
    justifyContent: "center",
    width: 50,

  },
  iconPlaceholder: {
    fontSize: fontSizes.heading,
    marginBottom: 4,
  },
  cardTypeText: {
    fontSize: fontSizes.small,
    fontWeight: "bold",
    color: "#1A1A1A",
  },
  cardMiddle: {
    flex: 1,
    paddingHorizontal: 16,
  },
  cardTitle: {
    fontSize: fontSizes.bodyLarge,
    fontWeight: "bold",
    color: "#000000",
    marginBottom: 4,
  },
  cardSubText: {
    fontSize: fontSizes.small,
    color: "#888888",
    marginTop: 2,
  },
  cardRight: {
    justifyContent: "center",
  },
  arrow: {
    fontSize: fontSizes.bodyLarge,
    color: "#CCCCCC",
  },
  // 🎯 請把這些新樣式貼進原本的 StyleSheet.create 裡面：
  settingsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    height: 56,
  },
  avatarSection: {
    alignItems: "center",
    marginTop: 10,
    marginBottom: 20,
  },
  avatarPlaceholderLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  editAvatarText: {
    fontSize: fontSizes.bodySmall,
    fontWeight: "bold",
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: fontSizes.body,
    fontWeight: "bold",
    color: "#000000",
    marginLeft: 24,
    marginBottom: 8,
    marginTop: 16,
  },
  cardGroup: {
    marginHorizontal: 20,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    height: 50,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  themeSwitchContainer: {
    width: 52,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  rowIcon: {
    fontSize: fontSizes.titleSmall,
    marginRight: 12,
  },
  rowLabel: {
    fontSize: fontSizes.body,
    fontWeight: "600",
    color: "#000000",
  },
  rowValue: {
    fontSize: fontSizes.body,
    fontWeight: "600",
    color: "#777777",
    maxWidth: 180,
  },
  nameEditContainer: {
    flex: 1,
    marginLeft: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  nameDisplayButton: {
    maxWidth: 190,
    flexDirection: "row",
    alignItems: "center",
  },
  nameEditIcon: {
    width: 18,
    height: 18,
    marginLeft: 7,
    resizeMode: "contain",
  },
  nameInput: {
    flex: 1,
    minWidth: 90,
    maxWidth: 150,
    height: 36,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
    fontSize: fontSizes.body,
    fontWeight: "600",
    textAlign: "right",
  },
  nameSaveText: {
    marginLeft: 10,
    fontSize: fontSizes.bodySmall,
    fontWeight: "900",
  },
  buttonGroup: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  logoutButton: {
    height: 50,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  logoutText: {
    color: "#FF5B5B",
    fontSize: fontSizes.bodyLarge,
    fontWeight: "bold",
  },
  deleteButton: {
    height: 50,
    backgroundColor: "#FF7E7E",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteText: {
    color: "#FFFFFF",
    fontSize: fontSizes.bodyLarge,
    fontWeight: "bold",
  },
  // 🎯 3. 確保最底下的 styles 有這一條，控制設定選單小圖示的大小
  rowItemIcon: {
    width: 24,
    height: 24,
    resizeMode: "contain",
    marginRight: 12,
  },

  compassIcon: {
    width: 24,
    height: 24,
    resizeMode: "contain",
    marginRight: 12,
  },
  typeIcon: {
    width: 24,
    height: 24,
    resizeMode: "contain",
    marginRight: 12,
  },
  mailIcon: {
    width: 24,
    height: 24,
    resizeMode: "contain",
    marginRight: 12,
  },
  cardItemIcon: {
    width: 35, 
    height: 35,
    resizeMode: "contain",
  },
  // 🎯 3. 補上標籤與時鐘的視覺樣式
  tagWrapper: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
    marginBottom: 6,
  },
  grayTag: {
    backgroundColor: "#EDEDED", // 淺灰色墊底
    paddingHorizontal: 8,       // 左右留白
    paddingVertical: 3,         // 上下留白
    borderRadius: 6,            // 圓角長方形
  },
  grayTagText: {
    fontSize: fontSizes.small,
    color: "#555555",           // 微深灰字體，看得很清楚
    fontWeight: "600",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",       // 讓時鐘圖片跟時間文字對齊
    marginTop: 4,
  },
  timeIcon: {
    width: 14,                  // 配合小字的大小
    height: 14,
    resizeMode: "contain",
    marginRight: 4,             // 與時間文字的小間距
  },
  // 🎯 請直接貼在 styles 大括號內部的最尾端
  avatarPickerRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 16,
    gap: 12, // 讓三張圖之間有舒適的間距
  },
  avatarPickerItem: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 3, // 用 3 號邊框來凸顯選中狀態
    padding: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarPickerImage: {
    width: "100%",
    height: "100%",
    resizeMode: "contain",
  },
});
