import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import MapView, { PROVIDER_GOOGLE } from "react-native-maps";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth, db, storage } from "../firebase";
import { fontSizes } from "./constants/theme";
import { useTheme } from "./ThemeContext"; // 🎯 1. 物理引入全域主題管家

const imageIcon = require("../assets/image.png");
const mapPinIcon = require("../assets/TypeMarker.png");

const reportLocation = { latitude: 24.988, longitude: 121.576 };
const reportRegion = { ...reportLocation, latitudeDelta: 0.0038, longitudeDelta: 0.0038 };
const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
const maxPhotoCount = 5;
const maxDangerTypeSuggestionCount = 4;
const dangerTypeSuggestionDelay = 450;
const dangerTypes = [{ id: "theft", label: "偷竊" }, { id: "harass", label: "騷擾" }, { id: "track", label: "跟蹤" }];

// 🎯 高質感地圖黑化 JSON
const googleMapDarkStyle = [
  { "elementType": "geometry", "stylers": [{ "color": "#212121" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
  { "featureType": "road", "elementType": "geometry.fill", "stylers": [{ "color": "#2c2c2c" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#000000" }] }
];

function buildGeocodingQueries(searchText) {
  return [searchText, `${searchText} 台灣`, `${searchText} 台北市`, `台北 ${searchText}`];
}

async function geocodeAddress(searchText) {
  if (!googleMapsApiKey) throw new Error("missing-api-key");
  const queries = buildGeocodingQueries(searchText);
  for (const query of queries) {
    const url = "https://maps.googleapis.com/maps/api/geocode/json" + `?address=${encodeURIComponent(query)}` + "&language=zh-TW&region=tw&components=country:TW" + `&key=${googleMapsApiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === "REQUEST_DENIED") throw new Error("request-denied");
    const result = data.results?.[0];
    const location = result?.geometry?.location;
    if (location) return { address: result.formatted_address, latitude: location.lat, longitude: location.lng };
  }
  return null;
}

function formatCurrentAddress(address) {
  if (address.formattedAddress) return address.formattedAddress;
  return [address.country, address.region, address.city, address.district, address.street, address.streetNumber, address.name]
    .filter((part, index, parts) => part && parts.indexOf(part) === index).join("");
}

function createCustomTypeId(typeLabel) { return `custom:${typeLabel}`; }
function getDangerTypeLabel(typeId, typeOptions) {
  const matchingType = typeOptions.find((type) => type.id === typeId);
  return matchingType?.label || typeId.replace(/^custom:/, "");
}
function createCustomTypeDocId(typeLabel) { return `custom-${encodeURIComponent(typeLabel)}`; }
function normalizeCustomTypeText(typeText) { return typeText.trim().replace(/^(?:#|＃)+/, "").trim(); }
function formatCustomTypeText(typeLabel) { return `#${typeLabel}`; }

async function uploadImageAsync(imageUri, signal) {
  const user = auth.currentUser;
  const userId = user?.uid || "anonymous";
  const imagePath = `reports/${userId}/${Date.now()}.jpg`;
  const imageRef = ref(storage, imagePath);
  try {
    if (!user) throw new Error("auth-required");
    const idToken = await user.getIdToken();
    const bucket = storage.app.options.storageBucket;
    const fileInfo = await FileSystem.getInfoAsync(imageUri);
    if (!fileInfo.exists || typeof fileInfo.size !== "number") throw new Error("image-file-unavailable");
    const fileResponse = await fetch(imageUri, { signal });
    if (!fileResponse.ok) throw new Error("failed-to-read-image");
    const fileBlob = await fileResponse.blob();
    const createUploadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o` + `?name=${encodeURIComponent(imagePath)}`;
    const createUploadResult = await fetch(createUploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Firebase ${idToken}`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": `${fileInfo.size}`,
        "X-Goog-Upload-Header-Content-Type": "image/jpeg",
        "X-Goog-Upload-Protocol": "resumable",
      },
      body: JSON.stringify({ name: imagePath, bucket, contentType: "image/jpeg" }),
      signal,
    });
    const resumableUploadUrl = createUploadResult.headers.get("X-Goog-Upload-URL");
    if (!createUploadResult.ok || !resumableUploadUrl) throw new Error("Firebase Storage start failed.");
    const uploadResult = await fetch(resumableUploadUrl, {
      method: "POST",
      body: fileBlob,
      headers: {
        Authorization: `Firebase ${idToken}`,
        "Content-Type": "image/jpeg",
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
      },
      signal,
    });
    if (!uploadResult.ok) throw new Error("Firebase Storage upload failed.");
    return getDownloadURL(imageRef);
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("upload-aborted");
    }
    throw error;
  }
}

function getUploadErrorMessage(error) {
  switch (error.code) {
    case "storage/unauthorized": return "Firebase Storage 拒絕上傳。請確認 Storage Rules 設定。";
    case "storage/bucket-not-found": return "找不到 Storage bucket。";
    default: return "目前無法送出回報，請稍後再試。";
  }
}

export default function AddPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { themeMode, colors } = useTheme(); // 🎯 2. 解構變色變數
  const mapRef = useRef(null);
  const hasSearchedLocationRef = useRef(false);
  const hasEditedLocationTextRef = useRef(false);
  const isSearchingLocationRef = useRef(false);
  const pulseAnimation = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0.65)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;
  const submissionCanceledRef = useRef(false);
  const uploadAbortControllerRef = useRef(null);
  const [selectedLocation, setSelectedLocation] = useState(reportLocation);
  const [mapRegion, setMapRegion] = useState(reportRegion);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [locationText, setLocationText] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [customTypeText, setCustomTypeText] = useState("");
  const [debouncedCustomTypeText, setDebouncedCustomTypeText] = useState("");
  const [customDangerTypes, setCustomDangerTypes] = useState([]);
  const [selectedImages, setSelectedImages] = useState([]);
  const [isPickingImage, setIsPickingImage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionStage, setSubmissionStage] = useState("idle");
  const [isFindingLocation, setIsFindingLocation] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState(auth.currentUser);
  const [locationRefreshCount, setLocationRefreshCount] = useState(0);
  const dangerTypeSuggestions = [...dangerTypes, ...customDangerTypes];

  useEffect(() => {
    if (submissionStage === "submitting") {
      pulseAnimation.setValue(0);
      const animation = Animated.loop(
        Animated.timing(pulseAnimation, {
          toValue: 1,
          duration: 1100,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        })
      );

      animation.start();
      return () => animation.stop();
    }

    if (submissionStage === "success") {
      successScale.setValue(0.65);
      successOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(successScale, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }),
        Animated.timing(successOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    }
  }, [pulseAnimation, submissionStage, successOpacity, successScale]);

  useEffect(() => {
    const suggestionTimeout = setTimeout(() => { setDebouncedCustomTypeText(customTypeText); }, dangerTypeSuggestionDelay);
    return () => clearTimeout(suggestionTimeout);
  }, [customTypeText]);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthChecked(true);
      if (!user) {
        setIsFindingLocation(false);
        setIsRefreshing(false);
        router.replace("/Login");
      }
    });
  }, [router]);

  useEffect(() => {
    const customTypesQuery = query(collection(db, "dangerTypes"), orderBy("createdAt", "desc"));
    return onSnapshot(customTypesQuery, (snapshot) => {
      setCustomDangerTypes(snapshot.docs.map((doc) => {
        const data = doc.data();
        const label = normalizeCustomTypeText(data.label || "");
        return label ? { id: createCustomTypeId(label), label } : null;
      }).filter(Boolean));
    }, (error) => console.error(error));
  }, []);

  useEffect(() => {
    if (!authChecked || !currentUser) return;
    let isMounted = true;
    async function centerMapOnUserLocation() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!isMounted || status !== "granted") { setIsFindingLocation(false); return; }
        const userLocation = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!isMounted) return;
        const userRegion = { latitude: userLocation.coords.latitude, longitude: userLocation.coords.longitude, latitudeDelta: reportRegion.latitudeDelta, longitudeDelta: reportRegion.longitudeDelta };
        if (hasSearchedLocationRef.current) return;
        setSelectedLocation({ latitude: userRegion.latitude, longitude: userRegion.longitude });
        setMapRegion(userRegion);
        mapRef.current?.animateToRegion(userRegion, 500);
        if (!hasEditedLocationTextRef.current) setLocationText("目前位置");
        try {
          const addresses = await Location.reverseGeocodeAsync({ latitude: userRegion.latitude, longitude: userRegion.longitude });
          const currentAddress = addresses[0] ? formatCurrentAddress(addresses[0]) : "";
          if (isMounted && currentAddress && !hasEditedLocationTextRef.current) { setLocationText(currentAddress); setSelectedAddress(currentAddress); }
        } catch {}
      } catch {} finally { if (isMounted) { setIsFindingLocation(false); setIsRefreshing(false); } }
    }
    centerMapOnUserLocation();
    return () => { isMounted = false; };
  }, [authChecked, currentUser, locationRefreshCount]);

  async function handleSearchLocation() {
    const searchText = locationText.trim();
    if (searchText.length < 2 || isSearchingLocationRef.current) return;
    isSearchingLocationRef.current = true;
    hasSearchedLocationRef.current = true;
    setIsSearchingLocation(true);
    try {
      const result = await geocodeAddress(searchText);
      if (!result) { Alert.alert("找不到地點", "請輸入更完整的地點名稱。"); return; }
      const nextLocation = { latitude: result.latitude, longitude: result.longitude };
      const nextRegion = { ...nextLocation, latitudeDelta: reportRegion.latitudeDelta, longitudeDelta: reportRegion.longitudeDelta };
      setSelectedAddress(result.address);
      setSelectedLocation(nextLocation);
      setMapRegion(nextRegion);
      setIsFindingLocation(false);
      mapRef.current?.animateToRegion(nextRegion, 600);
    } catch (error) { Alert.alert("搜尋失敗", "請確認 API 金鑰與網路狀態。"); } finally { isSearchingLocationRef.current = false; setIsSearchingLocation(false); }
  }

  function handleLocationInputFocus() { if (!hasEditedLocationTextRef.current) setLocationText(""); }
  function handleLocationInputBlur() { if (!locationText.trim()) { hasEditedLocationTextRef.current = false; setLocationText(selectedAddress || "目前位置"); return; } handleSearchLocation(); }
  function handleRefresh() {
    if (isSubmitting) return;
    hasSearchedLocationRef.current = false; hasEditedLocationTextRef.current = false; isSearchingLocationRef.current = false;
    setSelectedLocation(reportLocation); setMapRegion(reportRegion); setSelectedAddress(""); setLocationText(""); setDescription(""); setSelectedTypes([]); setCustomTypeText(""); setSelectedImages([]); setIsSearchingLocation(false); setIsFindingLocation(true); setIsRefreshing(true); setLocationRefreshCount((currentCount) => currentCount + 1);
  }

  function selectDangerType(typeId) { setSelectedTypes((currentTypes) => currentTypes.includes(typeId) ? currentTypes : [...currentTypes, typeId]); }
  function removeDangerType(typeId) { setSelectedTypes((currentTypes) => currentTypes.filter((currentTypeId) => currentTypeId !== typeId)); }
  async function addCustomType(customTypeLabel) {
    const matchingPresetType = dangerTypes.find((type) => type.label === customTypeLabel);
    const nextTypeId = matchingPresetType ? matchingPresetType.id : createCustomTypeId(customTypeLabel);
    if (!matchingPresetType) {
      await setDoc(doc(db, "dangerTypes", createCustomTypeDocId(customTypeLabel)), { id: nextTypeId, label: customTypeLabel, visibility: "public", createdBy: auth.currentUser?.uid || null, createdAt: serverTimestamp() }, { merge: true });
    }
    selectDangerType(nextTypeId); setCustomTypeText("#");
  }
  async function handleSelectExistingCustomType(customType) { selectDangerType(customType.id); setCustomTypeText("#"); }
  function handleCreateCustomType(typeLabel) {
    const customTypeLabel = normalizeCustomTypeText(typeLabel);
    if (!customTypeLabel) return;
    const exactExistingType = dangerTypeSuggestions.find((type) => type.label.toLocaleLowerCase() === customTypeLabel.toLocaleLowerCase());
    if (exactExistingType) { selectDangerType(exactExistingType.id); setCustomTypeText("#"); return; }
    Alert.alert("確認新增標籤", `確定要新增「#${customTypeLabel}」嗎？`, [
      { text: "取消", style: "cancel" },
      { text: "新增", onPress: async () => { try { await addCustomType(customTypeLabel); } catch { Alert.alert("新增失敗"); } } }
    ]);
  }

  function handleAddCustomType() { handleCreateCustomType(customTypeText); }
  function addSelectedImages(images) { setSelectedImages((currentImages) => [...currentImages, ...images.slice(0, maxPhotoCount - currentImages.length)]); }
  async function pickImageFromCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!result.canceled) addSelectedImages(result.assets);
  }
  async function pickImagesFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: maxPhotoCount - selectedImages.length, quality: 0.8 });
    if (!result.canceled) addSelectedImages(result.assets);
  }
  function handleAddPhoto() {
    if (selectedImages.length >= maxPhotoCount) { Alert.alert("已達上限", `每次最多上傳 ${maxPhotoCount} 張照片。`); return; }
    Alert.alert("新增圖片", "請選擇照片來源", [
      { text: "拍照", onPress: () => handlePickImage(pickImageFromCamera) },
      { text: "從圖庫選擇", onPress: () => handlePickImage(pickImagesFromLibrary) },
      { text: "取消", style: "cancel" },
    ]);
  }
  async function handlePickImage(pickImage) {
    if (isPickingImage) return; setIsPickingImage(true);
    try { await pickImage(); } catch { Alert.alert("無法新增圖片"); } finally { setIsPickingImage(false); }
  }
  function removeSelectedImage(indexToRemove) { setSelectedImages((currentImages) => currentImages.filter((_, index) => index !== indexToRemove)); }

  async function handleSubmitReport() {
    if (isSubmitting) return;
    const user = auth.currentUser;
    if (!user) { showLoginRequiredAlert("登入後才能新增回報。"); return; }
    if (!locationText.trim() || !description.trim() || selectedTypes.length === 0) { Alert.alert("資料未完成", "請完整填寫位置、危險類型與說明。"); return; }
    uploadAbortControllerRef.current = new AbortController();
    setIsSubmitting(true); setSubmissionStage("submitting"); submissionCanceledRef.current = false;
    let reportSubmitted = false;
    try {
      const imageUrls = [];
      for (const image of selectedImages) {
        imageUrls.push(await uploadImageAsync(image.uri, uploadAbortControllerRef.current.signal));
        if (submissionCanceledRef.current) return;
      }
      await addDoc(collection(db, "reports"), { locationText: locationText.trim(), selectedAddress, description: description.trim(), types: selectedTypes, markerType: selectedTypes[0], latitude: selectedLocation.latitude, longitude: selectedLocation.longitude, imageUrl: imageUrls[0] || "", imageUrls, credibleCount: 0, notCredibleCount: 0, userId: user.uid, createdAt: serverTimestamp() });
      if (submissionCanceledRef.current) return;
      setLocationText(""); setSelectedAddress(""); setDescription(""); setSelectedTypes([]); setCustomTypeText(""); setSelectedImages([]);
      reportSubmitted = true; setSubmissionStage("success");
      setTimeout(() => { setSubmissionStage("idle"); setIsSubmitting(false); router.replace("/"); }, 1400);
    } catch (error) {
      setSubmissionStage("idle");
      if (!submissionCanceledRef.current && error.message !== "upload-aborted") {
        Alert.alert("送出失敗", getUploadErrorMessage(error));
      }
    } finally {
      uploadAbortControllerRef.current = null;
      if (!reportSubmitted) setIsSubmitting(false);
    }
  }

  function handleCancelSubmit() {
    submissionCanceledRef.current = true;
    uploadAbortControllerRef.current?.abort();
    uploadAbortControllerRef.current = null;
    setSubmissionStage("idle");
    setIsSubmitting(false);
  }

  const customTypeQuery = normalizeCustomTypeText(customTypeText);
  const debouncedCustomTypeQuery = normalizeCustomTypeText(debouncedCustomTypeText);
  const availableDangerTypeSuggestions = dangerTypeSuggestions.filter((customType) => !selectedTypes.includes(customType.id));
  const matchingCustomTypeSuggestions = debouncedCustomTypeQuery ? availableDangerTypeSuggestions.filter((customType) => customType.label.toLocaleLowerCase().includes(debouncedCustomTypeQuery.toLocaleLowerCase())).slice(0, maxDangerTypeSuggestionCount) : availableDangerTypeSuggestions.slice(0, maxDangerTypeSuggestionCount);
  const shouldShowCustomTypeSuggestions = customTypeQuery === debouncedCustomTypeQuery;
  const isNewCustomType = customTypeQuery && !dangerTypeSuggestions.some((type) => type.label.toLocaleLowerCase() === customTypeQuery.toLocaleLowerCase());
  const selectedDangerTypeOptions = selectedTypes.map((typeId) => ({ id: typeId, label: getDangerTypeLabel(typeId, dangerTypeSuggestions) }));

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={themeMode === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.background} />

      {/* 🎯 3. Header 黑化 */}
      <View style={[styles.header, { height: Math.max(insets.top, 18) + 54, paddingTop: Math.max(insets.top, 18), backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>回報危險地點</Text>
      </View>

      <KeyboardAwareScrollView
        alwaysBounceVertical
        bottomOffset={20}
        contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 18) + 62, paddingBottom: Math.max(insets.bottom, 26) + 128 }]}
        disableScrollOnKeyboardHide
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.special}
            colors={[colors.special]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.mapCard}>
          {isFindingLocation ? (
            <View style={[styles.locationPlaceholder, { backgroundColor: themeMode === "dark" ? "#1E1E1E" : colors.background }]}>
              <Text style={[styles.locationOverlayText, { color: colors.text }]}>正在尋找定位...</Text>
            </View>
          ) : (
            <>
              <MapView
                ref={mapRef}
                provider={PROVIDER_GOOGLE}
                style={styles.map}
                customMapStyle={themeMode === "dark" ? googleMapDarkStyle : []}
                initialRegion={mapRegion}
                region={mapRegion}
                onRegionChangeComplete={(region) => { setMapRegion(region); setSelectedLocation({ latitude: region.latitude, longitude: region.longitude }); }}
              />
              <View pointerEvents="none" style={styles.centerMarker}>
                <Image source={mapPinIcon} style={styles.centerMarkerIcon} />
              </View>
            </>
          )}
        </View>

        {/* 🎯 4. 欄位輸入與卡片黑化連動 */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>1.大概位置描述</Text>
        <View style={[styles.searchBox, { backgroundColor: themeMode === "dark" ? "#1E1E1E" : colors.white }]}>
          <TextInput
            autoCorrect={false}
            style={[styles.searchInput, { color: colors.text }]}
            value={locationText}
            onBlur={handleLocationInputBlur}
            onChangeText={(text) => { hasEditedLocationTextRef.current = true; setLocationText(text); }}
            onFocus={handleLocationInputFocus}
          />
          <Pressable onPress={handleSearchLocation} style={styles.searchButton}>
            <Text style={styles.searchButtonText}>搜尋</Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>2.＃危險標籤</Text>
        {selectedDangerTypeOptions.length ? (
          <View style={styles.optionRow}>
            {selectedDangerTypeOptions.map((item) => (
              <Pressable key={item.id} onPress={() => removeDangerType(item.id)} style={[styles.optionCard, { backgroundColor: themeMode === "dark" ? "#2C2C2C" : colors.white, borderColor: colors.special }]}>
                <Text style={styles.optionRemove}>×</Text>
                <Text style={[styles.dangerTypeHash, { color: colors.text }]}>#</Text>
                <Text style={[styles.optionLabel, { color: colors.text }]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        
        <View style={[styles.customTypeBox, { backgroundColor: themeMode === "dark" ? "#1E1E1E" : colors.white }]}>
          <TextInput
            accessibilityLabel="新增危險標籤"
            autoCorrect={false}
            blurOnSubmit={false}
            enablesReturnKeyAutomatically
            placeholder="ex. 偷拍"
            placeholderTextColor={colors.special}
            returnKeyType="done"
            style={[styles.customTypeInput, { color: colors.text }]}
            value={customTypeText}
            onChangeText={setCustomTypeText}
            onSubmitEditing={handleAddCustomType}
          />
        </View>
        {shouldShowCustomTypeSuggestions ? (
          <View style={styles.customTypeSuggestions}>
            {matchingCustomTypeSuggestions.map((customType) => (
              <Pressable
                key={customType.id}
                accessibilityLabel={`選擇 ${formatCustomTypeText(customType.label)}`}
                accessibilityRole="button"
                onPress={() => handleSelectExistingCustomType(customType)}
                style={[
                  styles.customTypeSuggestion,
                  {
                    backgroundColor: themeMode === "dark" ? "#1E1E1E" : colors.white,
                    borderColor: colors.divider,
                  },
                ]}
              >
                <Text style={[styles.customTypeSuggestionHash, { color: colors.text }]}>#</Text>
                <Text style={[styles.customTypeSuggestionText, { color: colors.text }]}>
                  {customType.label}
                </Text>
              </Pressable>
            ))}
            {isNewCustomType ? (
              <Pressable
                accessibilityLabel={`新增 ${formatCustomTypeText(customTypeText)}`}
                accessibilityRole="button"
                onPress={() => handleCreateCustomType(customTypeText)}
                style={[
                  styles.customTypeSuggestion,
                  styles.customTypeCreateSuggestion,
                  {
                    backgroundColor: themeMode === "dark" ? "#1E1E1E" : colors.white,
                    borderColor: colors.divider,
                  },
                ]}
              >
                <Text style={[styles.customTypeSuggestionHash, { color: colors.text }]}>+</Text>
                <Text style={[styles.customTypeSuggestionText, { color: colors.text }]}>新增 {formatCustomTypeText(customTypeText)}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Text style={[styles.sectionTitle, { color: colors.text }]}>3.情況說明</Text>
        <TextInput
          multiline
          placeholder="請簡單描述您看到的情況..."
          placeholderTextColor="#666666"
          style={[styles.largeInput, { backgroundColor: themeMode === "dark" ? "#1E1E1E" : colors.white, color: colors.text }]}
          textAlignVertical="top"
          value={description}
          onChangeText={setDescription}
        />

        <Text style={[styles.sectionTitle, { color: colors.text }]}>4.上傳照片 (選填)</Text>
        <Pressable
          disabled={isPickingImage}
          onPress={handleAddPhoto}
          style={[
            styles.photoButton,
            { backgroundColor: themeMode === "dark" ? "#1E1E1E" : "#F0F0F0" },
            isPickingImage ? styles.photoButtonDisabled : null,
          ]}
        >
          <Image source={imageIcon} style={[styles.photoIcon, { tintColor: colors.text }]} />
          <Text style={[styles.photoButtonText, { color: colors.text }]}> 
            {isPickingImage ? "讀取中..." : "新增圖片"}
          </Text>
        </Pressable>
        {selectedImages.length ? (
          <>
            <ScrollView
              contentContainerStyle={styles.photoPreviewRow}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {selectedImages.map((image, index) => (
                <View key={`${image.uri}-${index}`} style={styles.photoPreview}>
                  <Image source={{ uri: image.uri }} style={styles.photoImage} />
                  <Pressable
                    accessibilityLabel={`移除第 ${index + 1} 張照片`}
                    accessibilityRole="button"
                    onPress={() => removeSelectedImage(index)}
                    style={styles.removePhotoButton}
                  >
                    <Text style={styles.removePhotoText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
            <Text style={[styles.photoCount, { color: colors.special }]}> 
              已選擇 {selectedImages.length}/{maxPhotoCount} 張照片
            </Text>
          </>
        ) : null}
        <Pressable onPress={handleSubmitReport} style={styles.submitButton}>
          <Text style={styles.submitButtonText}>送出回報</Text>
        </Pressable>
      </KeyboardAwareScrollView>

      <Modal
        animationType="fade"
        onRequestClose={() => {}}
        statusBarTranslucent
        transparent
        visible={submissionStage !== "idle"}
      >
        <View
          accessibilityLiveRegion="polite"
          accessibilityViewIsModal
          style={styles.submissionOverlay}
        >
          {submissionStage === "submitting" ? (
            <View style={styles.submissionCard}>
              <View style={styles.loadingAnimation}>
                <Animated.View
                  style={[
                    styles.loadingPulse,
                    {
                      opacity: pulseAnimation.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.55, 0],
                      }),
                      transform: [
                        {
                          scale: pulseAnimation.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.72, 1.45],
                          }),
                        },
                      ],
                    },
                  ]}
                />
                <ActivityIndicator color="#FFFFFF" size="large" />
              </View>
              <Text style={styles.submissionTitle}>正在送出回報</Text>
              <Text style={styles.submissionDescription}>請稍候，我們正在上傳資料...</Text>
              <Pressable
                accessibilityLabel="取消送出回報"
                accessibilityRole="button"
                onPress={handleCancelSubmit}
                style={styles.cancelSubmitButton}
              >
                <Text style={styles.cancelSubmitButtonText}>取消送出</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.submissionCard}>
              <Animated.View
                style={[
                  styles.successCircle,
                  {
                    opacity: successOpacity,
                    transform: [{ scale: successScale }],
                  },
                ]}
              >
                <Text style={styles.successCheck}>✓</Text>
              </Animated.View>
              <Text style={styles.submissionTitle}>回報成功送出</Text>
              <Text style={styles.submissionDescription}>謝謝你協助守護社區安全</Text>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

// 🎯 恢復靜態 StyleSheet 結構，刪除硬編碼配色
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", zIndex: 10 },
  title: { fontSize: fontSizes.heading, fontWeight: "900", textAlign: "center" },
  mapCard: { height: 184, marginTop: 8, borderRadius: 12, overflow: "hidden" },
  map: { width: "100%", height: "100%" },
  centerMarker: { position: "absolute", top: "50%", left: "50%", transform: [{ translateX: -16 }, { translateY: -32 }] },
  centerMarkerIcon: { width: 32, height: 32, resizeMode: "contain" },
  locationPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  locationOverlayText: { fontSize: fontSizes.bodyLarge, fontWeight: "900" },
  sectionTitle: { marginTop: 32, fontSize: fontSizes.title, fontWeight: "900" },
  largeInput: { minHeight: 80, marginTop: 10, paddingTop: 14, paddingHorizontal: 11, borderRadius: 9, fontSize: fontSizes.bodySmall, fontWeight: "800" },
  searchBox: { height: 50, marginTop: 10, borderRadius: 12, flexDirection: "row", alignItems: "center", overflow: "hidden" },
  searchInput: { flex: 1, height: "100%", paddingHorizontal: 14, fontSize: fontSizes.body, fontWeight: "800" },
  searchButton: { height: "100%", minWidth: 68, paddingHorizontal: 14, backgroundColor: "#A6BAAE", alignItems: "center", justifyContent: "center" },
  searchButtonText: { color: "#FFFFFF", fontSize: fontSizes.body, fontWeight: "900" },
  optionRow: { marginTop: 8, flexDirection: "row", flexWrap: "wrap", columnGap: 8, rowGap: 8 },
  optionCard: { minHeight: 32, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 2, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  optionRemove: { marginRight: 5, color: "#A6BAAE", fontSize: fontSizes.bodySmall, fontWeight: "900" },
  dangerTypeHash: { fontSize: fontSizes.bodySmall, fontWeight: "900" },
  optionLabel: { marginLeft: 5, fontSize: fontSizes.bodySmall, fontWeight: "900" },
  customTypeBox: { height: 46, marginTop: 10, borderRadius: 10, flexDirection: "row", alignItems: "center", overflow: "hidden" },
  customTypeInput: { flex: 1, height: "100%", paddingHorizontal: 13, fontSize: fontSizes.bodySmall, fontWeight: "800" },
  customTypeSuggestions: { marginTop: 8, flexDirection: "row", flexWrap: "wrap" },
  customTypeSuggestion: { minHeight: 34, marginRight: 8, marginBottom: 8, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1, flexDirection: "row", alignItems: "center" },
  customTypeCreateSuggestion: { borderStyle: "dashed" },
  customTypeSuggestionHash: { fontSize: fontSizes.bodySmall, fontWeight: "900", lineHeight: 20 },
  customTypeSuggestionText: { marginLeft: 5, fontSize: fontSizes.bodySmall, fontWeight: "800", lineHeight: 20 },
  photoButton: { width: 110, height: 80, marginTop: 11, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  photoButtonDisabled: { opacity: 0.7 },
  photoIcon: { width: 35, height: 35, marginBottom: 4, resizeMode: "contain" },
  photoButtonText: { fontSize: fontSizes.titleSmall, fontWeight: "900" },
  photoPreviewRow: { paddingTop: 12, paddingRight: 8 },
  photoPreview: { width: 88, height: 88, marginRight: 10 },
  photoImage: { width: "100%", height: "100%", borderRadius: 8 },
  removePhotoButton: { position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: "#000000", alignItems: "center", justifyContent: "center" },
  removePhotoText: { color: "#FFFFFF", fontSize: fontSizes.title, fontWeight: "900", lineHeight: 22 },
  photoCount: { marginTop: 7, fontSize: fontSizes.labelSmall, fontWeight: "800" },
  submitButton: { height: 43, marginTop: 40, borderRadius: 8, backgroundColor: "#A6BAAE", alignItems: "center", justifyContent: "center" },
  submitButtonText: { color: "#FFFFFF", fontSize: fontSizes.title, fontWeight: "900" },
  submissionOverlay: { flex: 1, paddingHorizontal: 24, backgroundColor: "rgba(44,48,46,0.66)", alignItems: "center", justifyContent: "center" },
  submissionCard: { width: "100%", maxWidth: 340, paddingVertical: 26, paddingHorizontal: 20, borderRadius: 18, backgroundColor: "rgba(100,125,112,0.96)", alignItems: "center" },
  loadingAnimation: { width: 76, height: 76, alignItems: "center", justifyContent: "center" },
  loadingPulse: { position: "absolute", width: 64, height: 64, borderRadius: 32, backgroundColor: "#FFFFFF" },
  successCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  successCheck: { color: "#A6BAAE", fontSize: fontSizes.successMark, fontWeight: "900", lineHeight: 52 },
  submissionTitle: { marginTop: 16, color: "#FFFFFF", fontSize: fontSizes.title, fontWeight: "900", lineHeight: 27, textAlign: "center" },
  submissionDescription: { marginTop: 7, color: "#FFFFFF", fontSize: fontSizes.bodySmall, fontWeight: "800", lineHeight: 20, textAlign: "center" },
  cancelSubmitButton: { minWidth: 110, height: 36, marginTop: 16, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  cancelSubmitButtonText: { color: "#A6BAAE", fontSize: fontSizes.bodySmall, fontWeight: "900", lineHeight: 20 },
});
