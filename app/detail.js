import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Image,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, deleteDoc, setDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth, db } from "../firebase";
import { colors, fontSizes } from "./constants/theme";
import { voteOnReport } from "../services/reportVoting";
import VoteSuccessToast from "./components/VoteSuccessToast";
import { useTheme } from "./ThemeContext"; // 🎯 1. 物理引入全域主題


const redDangerIcon = require("../assets/redDanger.png");
const mapPinIcon = require("../assets/MapPin.png");
const thumbsUpIcon = require("../assets/ThumbsUp.png");
const thumbsUpActiveIcon = require("../assets/ThumbUp-on.png");
const thumbsDownIcon = require("../assets/ThumbsDown.png");
const thumbsDownActiveIcon = require("../assets/ThumbsDown-on.png");
const sendIcon = require("../assets/Send-2.png");
const chevronIcon = require("../assets/Chevron right.png");
const trashIcon = require("../assets/Trash.png");

const typeLabels = { theft: "偷竊", harass: "騷擾", track: "跟蹤" };
const customTypePrefix = "custom:";

function formatTypeLabel(type) {
  let label = typeLabels[type] || type || "未分類";
  if (typeof type === "string" && type.startsWith(customTypePrefix)) {
    label = type.replace(customTypePrefix, "") || "未分類";
  }
  return label;
}

function formatCommentDate(createdAt) {
  const date = typeof createdAt?.toDate === "function" ? createdAt.toDate() : createdAt instanceof Date ? createdAt : typeof createdAt === "number" ? new Date(createdAt) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-TW", { year: "numeric", month: "numeric", day: "numeric" });
}

function getCommentTime(createdAt) {
  const date = typeof createdAt?.toDate === "function" ? createdAt.toDate() : createdAt instanceof Date ? createdAt : typeof createdAt === "number" ? new Date(createdAt) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function sortComments(comments, currentUserId) {
  return [...comments].sort((firstComment, secondComment) => {
    const firstIsMine = currentUserId && firstComment.userId === currentUserId ? 1 : 0;
    const secondIsMine = currentUserId && secondComment.userId === currentUserId ? 1 : 0;
    if (firstIsMine !== secondIsMine) return secondIsMine - firstIsMine;
    return getCommentTime(secondComment.createdAt) - getCommentTime(firstComment.createdAt);
  });
}

function CommentSuccessBanner({ animationKey, bottomOffset, themeMode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;
  const checkScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animationKey) return undefined;
    opacity.setValue(0);
    scale.setValue(0.9);
    checkScale.setValue(0);

    const animation = Animated.parallel([
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.delay(800),
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]),
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 110, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(90),
        Animated.spring(checkScale, { toValue: 1, friction: 5, tension: 150, useNativeDriver: true }),
      ]),
    ]);
    animation.start();
    return () => animation.stop();
  }, [animationKey, checkScale, opacity, scale]);

  return (
    <View pointerEvents="none" style={[styles.commentSuccessOverlay, { bottom: bottomOffset }]}>
      <Animated.View
        accessibilityLiveRegion="polite"
        style={[
          styles.commentSuccessBanner,
          {
            backgroundColor: themeMode === "dark" ? "#2C2C2C" : colors.white,
            borderColor: themeMode === "dark" ? "#444444" : colors.divider,
            opacity,
            transform: [{ scale }],
          },
        ]}
      >
        <Animated.View style={[styles.commentSuccessIconBubble, { transform: [{ scale: checkScale }] }]}>
          <Text style={styles.commentSuccessCheckMark}>✓</Text>
        </Animated.View>
        <Text style={[styles.commentSuccessText, { color: themeMode === "dark" ? colors.white : colors.black }]}>
          評論已送出
        </Text>
      </Animated.View>
    </View>
  );
}

const commentDeleteActionWidth = 76;

function CommentCard({
  avatarSource,
  comment,
  isOwnComment,
  onDelete,
  onLayout,
  themeMode,
  themeColors,
}) {
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
          isOwnComment &&
          isHorizontalSwipe &&
          (gestureState.dx < 0 || isDeleteActionOpenRef.current)
        );
      },
      onPanResponderGrant: () => {
        dragStartXRef.current = isDeleteActionOpenRef.current ? -commentDeleteActionWidth : 0;
      },
      onPanResponderMove: (_, gestureState) => {
        const nextTranslateX = Math.max(
          -commentDeleteActionWidth,
          Math.min(0, dragStartXRef.current + gestureState.dx)
        );
        translateX.setValue(nextTranslateX);
      },
      onPanResponderRelease: (_, gestureState) => {
        const nextTranslateX = dragStartXRef.current + gestureState.dx;
        animateTo(nextTranslateX < -commentDeleteActionWidth / 2 ? -commentDeleteActionWidth : 0);
      },
      onPanResponderTerminate: () => {
        animateTo(isDeleteActionOpenRef.current ? -commentDeleteActionWidth : 0);
      },
      onPanResponderTerminationRequest: (_, gestureState) =>
        Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
      onShouldBlockNativeResponder: () => false,
    })
  ).current;

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.commentSwipeContainer,
        { backgroundColor: themeMode === "dark" ? "#1E1E1E" : "#FFFFFF" },
      ]}
    >
      {isOwnComment ? (
        <Pressable
          accessibilityLabel="Delete comment"
          accessibilityRole="button"
          onPress={() => onDelete(comment)}
          style={styles.commentDeleteButton}
        >
          <Text style={styles.commentDeleteText}>刪除</Text>
        </Pressable>
      ) : null}

      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.commentCard,
          {
            backgroundColor: themeMode === "dark" ? "#1E1E1E" : "#FFFFFF",
            transform: [{ translateX }],
          },
        ]}
      >
        <View style={styles.commentCardContent}>
          <View style={styles.commentHeader}>
            <Image source={avatarSource} style={styles.avatarIcon} />
            <Text style={[styles.commentName, { color: themeColors.text }]}>
              {comment.userName || "匿名使用者"}
            </Text>
            {formatCommentDate(comment.createdAt) ? (
              <Text style={styles.commentDate}>{formatCommentDate(comment.createdAt)}</Text>
            ) : null}
          </View>
          <Text style={[styles.commentMessage, { color: themeMode === "dark" ? "#DDDDDD" : "#333333" }]}>
            {comment.message}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

export default function DetailPage() {
  const router = useRouter();
  const { reportId } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const {
    themeMode,
    colors,
    currentAvatarId,
    currentAvatarSource,
    allAvatars,
  } = useTheme(); // 🎯 2. 從管家提取動態變色變數
  const scrollViewRef = useRef(null);
  const commentListYRef = useRef(0);
  const pendingCommentIdRef = useRef(null);
  const [report, setReport] = useState(null);
  const [reportLoadState, setReportLoadState] = useState("loading");
  const [comments, setComments] = useState([]);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isVoting, setIsVoting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedVote, setSelectedVote] = useState(null);
  const [voteSuccessAnimationKey, setVoteSuccessAnimationKey] = useState(0);
  const [commentSuccessAnimationKey, setCommentSuccessAnimationKey] = useState(0);
  const [currentUser, setCurrentUser] = useState(auth.currentUser);
  const [previewImageUrl, setPreviewImageUrl] = useState(null);
  const currentReportId = Array.isArray(reportId) ? reportId[0] : reportId;
  const inputBottomPadding = Math.max(insets.bottom, 26);

  const scrollToComment = useCallback((commentY) => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({ y: Math.max(commentY - 18, 0), animated: true });
      }, 80);
    });
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (!user) setSelectedVote(null);
    });
  }, []);

  useEffect(() => { setSelectedVote(null); }, [currentReportId]);

  useEffect(() => {
    if (!currentReportId || !currentUser) {
      setSelectedVote(null);
      return undefined;
    }
    const unsubscribe = onSnapshot(doc(db, "reports", currentReportId, "votes", currentUser.uid), (snapshot) => {
      setSelectedVote(snapshot.exists() ? snapshot.data().vote : null);
    });
    return unsubscribe;
  }, [currentReportId, currentUser]);

  useEffect(() => {
    if (!currentReportId) {
      setReport(null);
      setReportLoadState("missing");
      return undefined;
    }
    setReport(null);
    setReportLoadState("loading");
    const unsubscribe = onSnapshot(doc(db, "reports", currentReportId), (snapshot) => {
      if (!snapshot.exists()) {
        setReport(null);
        setReportLoadState("missing");
        return;
      }
      setReport({ id: snapshot.id, ...snapshot.data() });
      setReportLoadState("ready");
    }, () => {
      setReportLoadState("error");
      Alert.alert("讀取失敗", "目前無法讀取回報內容，請稍後再試。");
    });
    return unsubscribe;
  }, [currentReportId]);

  useEffect(() => {
    if (!currentReportId) {
      setComments([]);
      return undefined;
    }
    const commentsQuery = query(collection(db, "reports", currentReportId, "comments"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(commentsQuery, (snapshot) => {
      const nextComments = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setComments(sortComments(nextComments, currentUser?.uid));
    }, () => {
      Alert.alert("讀取失敗", "目前無法讀取留言，請稍後再試。");
    });
    return unsubscribe;
  }, [currentReportId, currentUser?.uid]);

  const handleRefresh = useCallback(async () => {
    if (!currentReportId) return;
    setIsRefreshing(true);
    try {
      const reportRef = doc(db, "reports", currentReportId);
      const commentsQuery = query(collection(db, "reports", currentReportId, "comments"), orderBy("createdAt", "desc"));
      const requests = [getDoc(reportRef), getDocs(commentsQuery)];
      if (currentUser) {
        requests.push(getDoc(doc(db, "reports", currentReportId, "votes", currentUser.uid)));
      }
      const [reportSnapshot, commentsSnapshot, voteSnapshot] = await Promise.all(requests);
      setReport(reportSnapshot.exists() ? { id: reportSnapshot.id, ...reportSnapshot.data() } : null);
      setReportLoadState(reportSnapshot.exists() ? "ready" : "missing");
      const nextComments = commentsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setComments(sortComments(nextComments, currentUser?.uid));
      if (currentUser && voteSnapshot) {
        setSelectedVote(voteSnapshot.exists() ? voteSnapshot.data().vote : null);
      } else {
        setSelectedVote(null);
      }
    } catch {
      Alert.alert("刷新失敗", "目前無法更新回報內容，請稍後再試。");
    } finally { setIsRefreshing(false); }
  }, [currentReportId, currentUser]);

  async function handleSendComment() {
    if (isSending) return;
    const nextMessage = message.trim();
    const user = auth.currentUser;
    if (!report || !currentReportId) {
      Alert.alert("操作失敗", "該筆危險回報已被刪除，無法再發表評論。");
      return;
    }
    if (!user) {
      showLoginRequiredAlert("登入後才能發表評論。");
      return;
    }
    if (!nextMessage) return;
    setIsSending(true);
    try {
      const nextCommentRef = doc(collection(db, "reports", currentReportId, "comments"));
      pendingCommentIdRef.current = nextCommentRef.id;
      await setDoc(nextCommentRef, {
        message: nextMessage,
        userId: user.uid,
        userName: user.displayName || "NightWalk 使用者",
        avatarId: currentAvatarId,
        createdAt: serverTimestamp(),
        locationText: locationText,
      });
      setMessage("");
      setCommentSuccessAnimationKey((currentKey) => currentKey + 1);
    } catch {
      pendingCommentIdRef.current = null;
      Alert.alert("送出失敗", "目前無法送出留言，請稍後再試。");
    } finally { setIsSending(false); }
  }

  async function handleVote(nextVote) {
    if (!currentReportId || isVoting) return;
    if (!auth.currentUser) {
      showLoginRequiredAlert("登入後才能進行社群驗證投票。");
      return;
    }
    setIsVoting(true);
    try {
      const isNewVote = selectedVote !== nextVote;
      await voteOnReport(currentReportId, nextVote);
      setSelectedVote((currentVote) => currentVote === nextVote ? null : nextVote);
      if (isNewVote) setVoteSuccessAnimationKey((currentKey) => currentKey + 1);
    } catch (error) {
      if (error.message === "auth-required") {
        showLoginRequiredAlert("登入後才能進行社群驗證投票。");
        return;
      }
      Alert.alert("投票失敗", "目前無法送出投票，請稍後再試。");
    } finally { setIsVoting(false); }
  }

  function handleDeleteComment(comment) {
    const user = auth.currentUser;
    if (!user || comment.userId !== user.uid || !currentReportId) {
      return;
    }

    Alert.alert(
      "刪除留言",
      "確定要刪除這則留言嗎？刪除後將無法復原。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "確定刪除",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(doc(db, "reports", currentReportId, "comments", comment.id));
            } catch (error) {
              console.error("刪除留言失敗:", error);
              Alert.alert("刪除失敗", "目前無法刪除留言，請稍後再試。");
            }
          },
        },
      ]
    );
  }

  function showLoginRequiredAlert(message) {
    Alert.alert("請先登入", message, [
      { text: "取消", style: "cancel" },
      { text: "前往登入", onPress: () => router.push("/Login") },
    ]);
  }

  async function handleDeleteReport() {
    if (!currentReportId) return;
    Alert.alert(
      "刪除回報", 
      "您確定要刪除這筆危險地點回報嗎？此操作將無法復原。",
      [
        { text: "取消", style: "cancel" },
        { 
          text: "確定刪除", 
          style: "destructive", 
          onPress: async () => {
            try {
              await deleteDoc(doc(db, "reports", currentReportId));
              Alert.alert("刪除成功", "該筆回報已成功移除。");
              router.back(); 
            } catch (error) {
              console.error("刪除回報失敗:", error);
              Alert.alert("操作失敗", "目前無法刪除該資料，請稍後再試。");
            }
          } 
        }
      ]
    );
  }

  const credibleCount = report?.credibleCount ?? 0;
  const notCredibleCount = report?.notCredibleCount ?? 0;
  const voteCount = credibleCount + notCredibleCount;
  const locationText = report?.locationText || report?.selectedAddress || "未提供位置描述";
  const typeList = report?.types?.length ? report.types : [];
  const imageUrls = report?.imageUrls?.length ? report.imageUrls : report?.imageUrl ? [report.imageUrl] : [];
  const warningIcon = redDangerIcon;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.screen}>
          <StatusBar barStyle={themeMode === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.background} />

          {/* 🎯 3. 頂部 Header 黑化連動 */}
          <View
            style={[
              styles.header,
              {
                height: Math.max(insets.top, 18) + 54,
                paddingTop: Math.max(insets.top, 18),
                backgroundColor: colors.background,
              },
            ]}
          >
            
            <Pressable accessibilityLabel="Go back" accessibilityRole="button" onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
              <Image source={chevronIcon} style={[styles.backIcon, { tintColor: colors.text }]} />
              
            </Pressable>
            <Text style={[styles.headerTitle, { color: colors.text }]}>回報詳細頁</Text>
            {currentUser && report?.userId === currentUser.uid ? (
              <Pressable
                accessibilityLabel="刪除回報"
                accessibilityRole="button"
                hitSlop={12}
                onPress={handleDeleteReport}
                style={styles.deleteHeaderButton}
              >
                <Image
                  source={trashIcon}
                  style={[styles.deleteHeaderIcon, { tintColor: colors.red }]}
                />
              </Pressable>
            ) : ( <View style={styles.headerSpacer} /> )}
          </View>

          <ScrollView
            ref={scrollViewRef}
            alwaysBounceVertical
            contentContainerStyle={[styles.content, { paddingBottom: inputBottomPadding + 114 }]}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={Keyboard.dismiss}
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.special} colors={[colors.special]} />
            }
            showsVerticalScrollIndicator={false}
            style={styles.scrollView}
          >
            {reportLoadState === "missing" ? (
              <View style={styles.deletedReportState}>
                <Text style={[styles.deletedReportTitle, { color: colors.text }]}>該回報已刪除</Text>
                <Text style={[styles.deletedReportMessage, { color: themeMode === "dark" ? "#AAAAAA" : "#777777" }]}>
                  這筆留言所屬的危險回報已不存在。
                </Text>
              </View>
            ) : reportLoadState === "ready" ? (
              <>
                {/* 🎯 4. 主要危險卡片黑化連動 */}
                <View style={[styles.reportCard, { backgroundColor: themeMode === "dark" ? "#1E1E1E" : "#FFFFFF" }]}>
                  <View style={styles.reportHeader}>
                    <Image source={warningIcon} style={styles.warningIcon} />
                    <View style={styles.reportTitleGroup}>
                      <Text style={[styles.reportTitle, { color: colors.text }]}>危險回報</Text>
                      <View style={styles.locationRow}>
                        <Image
                          source={mapPinIcon}
                          style={[styles.locationIcon, { tintColor: themeMode === "dark" ? "#AAAAAA" : "#000000" }]}
                        />
                        <Text style={[styles.locationText, { color: colors.text }]}>{locationText}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.tagRow}>
                    {typeList.length ? (
                      typeList.map((type) => (
                        <View
                          key={type}
                          style={[styles.tag, { backgroundColor: themeMode === "dark" ? "#333333" : "#EDEDED" }]}
                        >
                          <Text style={[styles.tagHash, { color: colors.text }]}>#</Text>
                          <Text style={[styles.tagText, { color: colors.text }]}>{formatTypeLabel(type)}</Text>
                        </View>
                      ))
                    ) : (
                      <View style={[styles.tag, { backgroundColor: themeMode === "dark" ? "#333333" : "#EDEDED" }]}>
                        <Text style={[styles.tagHash, { color: colors.text }]}>#</Text>
                        <Text style={[styles.tagText, { color: colors.text }]}>未分類</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.description, { color: themeMode === "dark" ? "#DDDDDD" : "#1A1A1A" }]}>
                    {report?.description || "尚未提供情況說明。"}
                  </Text>
                </View>

                {imageUrls.length ? (
                  <ScrollView
                    contentContainerStyle={styles.reportImageRow}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {imageUrls.map((imageUrl, index) => (
                      <Pressable
                        key={`${imageUrl}-${index}`}
                        onPress={() => setPreviewImageUrl(imageUrl)}
                        style={[styles.reportImageCard, { backgroundColor: themeMode === "dark" ? "#1E1E1E" : "#FFFFFF" }]}
                      >
                        <Image
                          accessibilityLabel={`Report photo ${index + 1}`}
                          resizeMode="cover"
                          source={{ uri: imageUrl }}
                          style={styles.reportImage}
                        />
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}

                {/* 🎯 5. 投票社群驗證卡片黑化連動 */}
                <View style={[styles.voteCard, { backgroundColor: themeMode === "dark" ? "#1E1E1E" : "#FFFFFF" }]}>
                  <View style={styles.voteTitleRow}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>社群驗證</Text>
                    <Text style={styles.voteHint}>(已有 {voteCount} 人投票)</Text>
                  </View>
                  <View style={styles.voteRow}>
                    <Pressable
                      accessibilityLabel="Trust this danger report"
                      accessibilityRole="button"
                      disabled={isVoting}
                      onPress={() => handleVote("credible")}
                      style={[
                        styles.voteButton,
                        { backgroundColor: themeMode === "dark" ? "#2C2C2C" : colors.surfaceMuted },
                        selectedVote === "credible" ? styles.voteButtonActive : null,
                      ]}
                    >
                      <Image
                        source={selectedVote === "credible" ? thumbsUpActiveIcon : thumbsUpIcon}
                        style={[
                          styles.voteIcon,
                          {
                            tintColor: selectedVote === "credible"
                              ? undefined
                              : themeMode === "dark"
                                ? "#FFFFFF"
                                : undefined,
                          },
                        ]}
                      />
                      <Text
                        style={[
                          styles.voteText,
                          { color: themeMode === "dark" ? "#FFFFFF" : colors.black },
                          selectedVote === "credible" ? styles.voteTextActive : null,
                        ]}
                      >
                        可信({credibleCount})
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Distrust this danger report"
                      accessibilityRole="button"
                      disabled={isVoting}
                      onPress={() => handleVote("notCredible")}
                      style={[
                        styles.voteButton,
                        { backgroundColor: themeMode === "dark" ? "#2C2C2C" : colors.surfaceMuted },
                        selectedVote === "notCredible" ? styles.voteButtonActive : null,
                      ]}
                    >
                      <Image
                        source={selectedVote === "notCredible" ? thumbsDownActiveIcon : thumbsDownIcon}
                        style={[
                          styles.voteIcon,
                          {
                            tintColor: selectedVote === "notCredible"
                              ? undefined
                              : themeMode === "dark"
                                ? "#FFFFFF"
                                : undefined,
                          },
                        ]}
                      />
                      <Text
                        style={[
                          styles.voteText,
                          { color: themeMode === "dark" ? "#FFFFFF" : colors.black },
                          selectedVote === "notCredible" ? styles.voteTextActive : null,
                        ]}
                      >
                        不可信({notCredibleCount})
                      </Text>
                    </Pressable>
                  </View>
                </View>

                <Text style={[styles.commentTitle, { color: colors.text }]}>留言</Text>

                {/* 🎯 6. 評論列表卡片黑化連動 */}
                <View
                  onLayout={(event) => {
                    commentListYRef.current = event.nativeEvent.layout.y;
                  }}
                  style={styles.commentList}
                >
                  {comments.map((comment) => (
                    <CommentCard
                      avatarSource={
                        allAvatars[comment.avatarId] ||
                        (currentUser?.uid === comment.userId
                          ? currentAvatarSource
                          : allAvatars.avatar1)
                      }
                      comment={comment}
                      isOwnComment={Boolean(currentUser && comment.userId === currentUser.uid)}
                      key={comment.id}
                      onLayout={(event) => {
                        if (pendingCommentIdRef.current !== comment.id) {
                          return;
                        }

                        const commentY = commentListYRef.current + event.nativeEvent.layout.y;
                        pendingCommentIdRef.current = null;
                        scrollToComment(commentY);
                      }}
                      onDelete={handleDeleteComment}
                      themeColors={colors}
                      themeMode={themeMode}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>

          {/* 🎯 7. 底部黏性輸入框全域底層黑化連動 */}
          {reportLoadState === "ready" ? (
            <KeyboardStickyView offset={{ closed: 0, opened: inputBottomPadding }} style={[styles.inputBar, { paddingBottom: inputBottomPadding, backgroundColor: colors.background }]}>
              <View style={[styles.inputCard, { backgroundColor: themeMode === "dark" ? "#1E1E1E" : "#FFFFFF" }]}>
                <Image source={currentAvatarSource} style={styles.inputAvatarIcon} />
                <TextInput
                  editable={!isSending}
                  maxLength={500}
                  onChangeText={setMessage}
                  onSubmitEditing={handleSendComment}
                  placeholder={currentUser ? "發表你的評論..." : "登入後才能發表評論"}
                  placeholderTextColor={themeMode === "dark" ? "#666666" : colors.special}
                  returnKeyType="send"
                  style={[styles.commentInput, { color: colors.text }]}
                  value={message}
                />
                <Pressable disabled={isSending || !message.trim()} onPress={handleSendComment} style={[styles.sendButton, isSending || !message.trim() ? styles.sendButtonDisabled : null]}>
                  <Image source={sendIcon} style={[styles.sendIcon, { tintColor: colors.special }]} />
                </Pressable>
              </View>
            </KeyboardStickyView>
          ) : null}

          {reportLoadState === "ready" ? (
            <>
              <VoteSuccessToast animationKey={voteSuccessAnimationKey} />
              <CommentSuccessBanner
                animationKey={commentSuccessAnimationKey}
                bottomOffset={inputBottomPadding + 86}
                themeMode={themeMode}
              />
            </>
          ) : null}

          <Modal
            animationType="fade"
            onRequestClose={() => setPreviewImageUrl(null)}
            statusBarTranslucent
            transparent
            visible={!!previewImageUrl}
          >
            <Pressable
              onPress={() => setPreviewImageUrl(null)}
              style={styles.imagePreviewOverlay}
            >
              <Image
                accessibilityLabel="Preview image"
                resizeMode="contain"
                source={{ uri: previewImageUrl || "" }}
                style={styles.imagePreviewContent}
              />
            </Pressable>
          </Modal>
      </View>
    </View>
  );
}

// 🎯 這裡百分之百補回了你的精美排版與樣式。結構完全對齊，絕無更動任何設計與動畫
const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  deletedReportState: {
    flex: 1,
    minHeight: 320,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  deletedReportTitle: {
    fontSize: fontSizes.title,
    fontWeight: "900",
    textAlign: "center",
  },
  deletedReportMessage: {
    marginTop: 10,
    fontSize: fontSizes.bodySmall,
    fontWeight: "600",
    lineHeight: 21,
    textAlign: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    zIndex: 10,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: {
    width: 24,
    height: 24,
    resizeMode: "contain",
    transform: [{ rotate: "180deg" }],
  },
  headerTitle: {
    fontSize: fontSizes.titleMedium,
    fontWeight: "900",
    textAlign: "center",
    flex: 1,
  },
  headerSpacer: {
    width: 34,
  },
  deleteHeaderButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteHeaderIcon: {
    width: 24,
    height: 24,
    resizeMode: "contain",
  },
  reportCard: {
    borderRadius: 16,
    padding: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  reportHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  warningIcon: {
    width: 44,
    height: 44,
    resizeMode: "contain",
  },
  reportTitleGroup: {
    flex: 1,
    marginLeft: 14,
    justifyContent: "center",
  },
  reportTitle: {
    fontSize: fontSizes.titleSmall,
    fontWeight: "900",
    lineHeight: 24,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  locationIcon: {
    width: 15,
    height: 15,
    resizeMode: "contain",
    marginRight: 4,
  },
  locationText: {
    fontSize: fontSizes.bodySmall,
    fontWeight: "700",
    flex: 1,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 8,
    rowGap: 8,
    marginTop: 14,
    marginBottom: 4,
  },
  tag: {
    height: 32,
    paddingHorizontal: 11,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  tagHash: {
    fontSize: fontSizes.bodySmall,
    fontWeight: "900",
  },
  tagText: {
    marginLeft: 4,
    fontSize: fontSizes.bodySmall,
    fontWeight: "800",
  },
  description: {
    marginTop: 12,
    fontSize: fontSizes.bodySmall,
    fontWeight: "600",
    lineHeight: 21,
  },
  reportImageRow: {
    marginTop: 12,
    columnGap: 10,
  },
  reportImageCard: {
    width: 220,
    height: 156,
    borderRadius: 14,
    overflow: "hidden",
    elevation: 1,
  },
  reportImage: {
    width: "100%",
    height: "100%",
  },
  voteCard: {
    marginTop: 14,
    borderRadius: 16,
    padding: 18,
    elevation: 1,
  },
  voteTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: fontSizes.bodyLarge,
    fontWeight: "900",
  },
  voteHint: {
    marginLeft: 8,
    color: "#888888",
    fontSize: fontSizes.footnote,
    fontWeight: "700",
    lineHeight: 15,
  },
  voteRow: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  voteButton: {
    width: "47%",
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  voteButtonActive: {
    backgroundColor: colors.special,
  },
  voteText: {
    marginLeft: 8,
    color: colors.black,
    fontSize: fontSizes.bodySmall,
    fontWeight: "800",
    lineHeight: 18,
  },
  voteTextActive: {
    color: colors.white,
  },
  voteIcon: {
    width: 21,
    height: 21,
    resizeMode: "contain",
  },
  commentTitle: {
    marginTop: 24,
    marginLeft: 4,
    marginBottom: 12,
    fontSize: fontSizes.bodyLarge,
    fontWeight: "900",
  },
  commentList: {
    rowGap: 12,
  },
  commentSwipeContainer: {
    position: "relative",
    borderRadius: 14,
    overflow: "hidden",
    elevation: 1,
  },
  commentDeleteButton: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: commentDeleteActionWidth,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  commentDeleteText: {
    color: colors.white,
    fontSize: fontSizes.bodySmall,
    fontWeight: "900",
  },
  commentCard: {
    borderRadius: 14,
  },
  commentCardContent: {
    padding: 14,
  },
  commentHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    resizeMode: "contain",
  },
  commentName: {
    marginLeft: 8,
    fontSize: fontSizes.bodySmall,
    fontWeight: "800",
    flex: 1,
  },
  commentDate: {
    color: "#888888",
    fontSize: fontSizes.caption,
    fontWeight: "600",
  },
  commentMessage: {
    marginTop: 8,
    marginLeft: 32,
    fontSize: fontSizes.bodySmall,
    fontWeight: "600",
    lineHeight: 19,
  },
  inputBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    zIndex: 10,
  },
  inputCard: {
    height: 58,
    borderRadius: 29,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.02,
    shadowRadius: 8,
    elevation: 3,
  },
  inputAvatarIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    resizeMode: "contain",
  },
  commentInput: {
    flex: 1,
    height: "100%",
    marginLeft: 10,
    fontSize: fontSizes.bodySmall,
    fontWeight: "800",
  },
  sendButton: {
    width: 32,
    height: 32,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendIcon: {
    width: 24,
    height: 24,
    resizeMode: "contain",
  },
  commentSuccessOverlay: {
    position: "absolute",
    left: 20,
    right: 20,
    zIndex: 12,
    alignItems: "center",
  },
  commentSuccessBanner: {
    minHeight: 42,
    paddingVertical: 8,
    paddingLeft: 9,
    paddingRight: 16,
    borderRadius: 21,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  commentSuccessIconBubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#A6BAAE",
    alignItems: "center",
    justifyContent: "center",
  },
  commentSuccessCheckMark: {
    color: colors.white,
    fontSize: fontSizes.bodyLarge,
    fontWeight: "900",
    lineHeight: 20,
  },
  commentSuccessText: {
    marginLeft: 10,
    fontSize: fontSizes.bodySmall,
    fontWeight: "900",
  },
  imagePreviewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  imagePreviewContent: {
    width: "100%",
    height: "100%",
  },
});
