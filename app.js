// Global variables
let selectedFile = null;
let currentSegments = [];
let currentModelId = null;
let currentLoadingModelId = null;
let progressMap = {};
let isTransformersReady = false;

// Local model variables
let selectedModelFiles = {};
let isLocalModelLoaded = false;

// Web Worker instance
let sttWorker = null;

// Models configuration
const MODEL_CONFIGS = {
  tiny: { id: 'tiny', name: 'Tiny (~75MB)', size: '75MB', path: 'Xenova/whisper-tiny' },
  base: { id: 'base', name: 'Base (~140MB)', size: '140MB', path: 'Xenova/whisper-base' },
  small: { id: 'small', name: 'Small (~460MB)', size: '460MB', path: 'Xenova/whisper-small' },
  medium: { id: 'medium', name: 'Medium (~1.5GB)', size: '1.5GB', path: 'Xenova/whisper-medium' }
};

// DOM Elements
const modelListContainer = document.getElementById('model-list-container');
const downloadProgressBox = document.getElementById('download-progress-box');
const downloadingModelName = document.getElementById('downloading-model-name');
const downloadPercentage = document.getElementById('download-percentage');
const downloadProgressBar = document.getElementById('download-progress-bar');
const downloadBytesRatio = document.getElementById('download-bytes-ratio');
const cancelDownloadBtn = document.getElementById('cancel-download-btn');

// Model Source Elements
const selectModelSource = document.getElementById('select-model-source');
const localModelPickerGroup = document.getElementById('local-model-picker-group');
const modelSelectGroup = document.getElementById('model-select-group');
const btnPickModelDir = document.getElementById('btn-pick-model-dir');
const inputModelDir = document.getElementById('input-model-dir');
const localModelStatus = document.getElementById('local-model-status');

const selectModel = document.getElementById('select-model');
const selectLanguage = document.getElementById('select-language');
const toggleTraditional = document.getElementById('toggle-traditional');

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const fileInfo = document.getElementById('file-info');
const fileNameEl = document.getElementById('file-name');
const fileSizeEl = document.getElementById('file-size');
const fileTypeIcon = document.getElementById('file-type-icon');
const removeFileBtn = document.getElementById('remove-file-btn');
const startTranscribeBtn = document.getElementById('start-transcribe-btn');

const statusCard = document.getElementById('status-card');
const statusTitle = document.getElementById('status-title');
const stepUpload = document.getElementById('step-upload');
const stepFfmpeg = document.getElementById('step-ffmpeg');
const stepWhisper = document.getElementById('step-whisper');

// Timer & ETA elements
const statusTimerBox = document.getElementById('status-timer-box');
const timerElapsed = document.getElementById('timer-elapsed');
const timerEta = document.getElementById('timer-eta');

const resultCard = document.getElementById('result-card');
const resultActionsBox = document.getElementById('result-actions-box');
const emptyResultState = document.getElementById('empty-result-state');
const resultTabsBox = document.getElementById('result-tabs-box');
const audioPlayerBox = document.getElementById('audio-player-box');
const audioPlayer = document.getElementById('audio-player');
const timelineContainer = document.getElementById('timeline-container');
const fulltextContainer = document.getElementById('fulltext-container');

const copyBtn = document.getElementById('copy-btn');
const exportTxtBtn = document.getElementById('export-txt-btn');
const exportSrtBtn = document.getElementById('export-srt-btn');
const toastContainer = document.getElementById('toast-container');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  initDragAndDrop();
  initTabNavigation();
  initPlaybackSync();

  // Event Listeners
  browseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);
  removeFileBtn.addEventListener('click', clearFile);
  startTranscribeBtn.addEventListener('click', startTranscription);
  cancelDownloadBtn.addEventListener('click', cancelDownload);
  copyBtn.addEventListener('click', copyTranscriptText);
  exportTxtBtn.addEventListener('click', exportAsTxt);
  exportSrtBtn.addEventListener('click', exportAsSrt);

  // Model Source select elements listeners
  selectModelSource.addEventListener('change', handleModelSourceChange);
  btnPickModelDir.addEventListener('click', () => inputModelDir.click());
  inputModelDir.addEventListener('change', handleLocalModelDirSelect);

  // If transformers loaded before DOMContentLoaded
  if (window.pipeline) {
    onTransformersLoaded();
  }
});

// Callback when Transformers.js is loaded
window.onTransformersReady = function() {
  if (document.readyState === 'loading') {
    return;
  }
  onTransformersLoaded();
};

// Get estimation factor based on model size / identifier
function getModelFactor(modelId) {
  if (modelId === 'local-model') {
    // Sum size of .onnx files in selectedModelFiles to estimate processing speed
    let totalOnnxSize = 0;
    for (const filename in selectedModelFiles) {
      if (filename.endsWith('.onnx')) {
        totalOnnxSize += selectedModelFiles[filename].size;
      }
    }
    const mb = totalOnnxSize / (1024 * 1024);
    if (mb > 0) {
      if (mb < 120) return 0.08;  // Tiny-like speed
      if (mb < 200) return 0.15;  // Base-like speed
      if (mb < 650) return 0.45;  // Small-like speed
      return 1.50;               // Medium-like speed or larger
    }
    return 0.15; // default base fallback
  }
  
  const factors = {
    tiny: 0.08,
    base: 0.15,
    small: 0.45,
    medium: 1.50
  };
  return factors[modelId] || 0.15;
}

function onTransformersLoaded() {
  if (isTransformersReady) return;
  isTransformersReady = true;
  refreshModelsUI();
}

// Get or initialize Web Worker
function getWorker() {
  if (sttWorker) return sttWorker;

  const workerCode = `
    importScripts('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');

    const { pipeline, env } = self.transformers;

    let transcriber = null;
    let currentModelId = null;
    let selectedModelFiles = {};
    let selectModelSource = 'cdn';

    // Setup custom fetch inside worker
    env.allowLocalModels = false;
    env.fetch = async (url, options) => {
      if (selectModelSource === 'local' && url.includes('local-model')) {
        for (const relPath in selectedModelFiles) {
          const encodedRelPath = encodeURI(relPath);
          if (url.endsWith(relPath) || url.endsWith(encodedRelPath)) {
            const fileBlob = selectedModelFiles[relPath];
            return new Response(fileBlob, {
              status: 200,
              statusText: 'OK',
              headers: new Headers({
                'Content-Type': 'application/octet-stream',
                'Content-Length': fileBlob.size.toString()
              })
            });
          }
        }
      }
      return fetch(url, options);
    };

    self.onmessage = async (e) => {
      const { type, data } = e.data;
      
      if (type === 'init') {
        selectModelSource = data.selectModelSource;
        selectedModelFiles = data.selectedModelFiles || {};
        const { modelId, modelPath } = data;
        
        try {
          if (selectModelSource === 'local') {
            transcriber = null; // force reload for local
          }
          
          if (currentModelId !== modelId || !transcriber) {
            transcriber = await pipeline('automatic-speech-recognition', modelPath, {
              progress_callback: (progressData) => {
                self.postMessage({ type: 'progress', data: progressData });
              }
            });
            currentModelId = modelId;
          }
          self.postMessage({ type: 'status', data: 'ready' });
        } catch (err) {
          self.postMessage({ type: 'error', data: err.message });
        }
      }
      
      else if (type === 'transcribe') {
        const { audioData, options } = data;
        try {
          const result = await transcriber(audioData, options);
          self.postMessage({ type: 'result', data: result });
        } catch (err) {
          self.postMessage({ type: 'error', data: err.message });
        }
      }
    };
  `;

  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);
  sttWorker = new Worker(workerUrl);
  return sttWorker;
}

// Load Model off the main thread in Web Worker
function loadModelInWorker(modelId, modelPath, selectModelSourceVal, selectedModelFilesMap) {
  return new Promise((resolve, reject) => {
    const worker = getWorker();
    
    // Intercept messages to resolve this load
    const originalOnMessage = worker.onmessage;
    
    worker.onmessage = (e) => {
      const { type, data } = e.data;
      if (type === 'progress') {
        progressCallback(data);
      } else if (type === 'status' && data === 'ready') {
        worker.onmessage = originalOnMessage;
        resolve();
      } else if (type === 'error') {
        worker.onmessage = originalOnMessage;
        reject(new Error(data));
      }
    };
    
    worker.postMessage({
      type: 'init',
      data: {
        modelId,
        modelPath,
        selectModelSource: selectModelSourceVal,
        selectedModelFiles: selectedModelFilesMap
      }
    });
  });
}

// Transcribe off the main thread in Web Worker (uses transferable Float32Array buffer)
function transcribeInWorker(audioData, options) {
  return new Promise((resolve, reject) => {
    const worker = getWorker();
    
    const originalOnMessage = worker.onmessage;
    
    worker.onmessage = (e) => {
      const { type, data } = e.data;
      if (type === 'result') {
        worker.onmessage = originalOnMessage;
        resolve(data);
      } else if (type === 'error') {
        worker.onmessage = originalOnMessage;
        reject(new Error(data));
      }
    };
    
    // Post message transferring the buffer directly
    worker.postMessage({
      type: 'transcribe',
      data: {
        audioData,
        options
      }
    }, [audioData.buffer]);
  });
}

// Setup custom env.fetch interceptor for local model loading
function setupCustomFetch() {
  // Keeping this function signature as fallback, but Web Worker handles this internally now
}

// Handle Model Source switching
function handleModelSourceChange() {
  if (selectModelSource.value === 'local') {
    localModelPickerGroup.classList.remove('hidden');
    modelSelectGroup.classList.add('hidden');
    if (selectedFile && isLocalModelLoaded) {
      startTranscribeBtn.classList.remove('disabled');
    } else {
      startTranscribeBtn.classList.add('disabled');
    }
  } else {
    localModelPickerGroup.classList.add('hidden');
    modelSelectGroup.classList.remove('hidden');
    if (selectedFile && selectModel.value) {
      startTranscribeBtn.classList.remove('disabled');
    } else {
      startTranscribeBtn.classList.add('disabled');
    }
  }
}

// Handle local model folder selection
function handleLocalModelDirSelect() {
  selectedModelFiles = {};
  let fileCount = 0;
  
  for (let i = 0; i < inputModelDir.files.length; i++) {
    const file = inputModelDir.files[i];
    const pathParts = file.webkitRelativePath.split('/');
    pathParts.shift(); // Remove top level dir name
    const relPath = pathParts.join('/');
    selectedModelFiles[relPath] = file;
    fileCount++;
  }
  
  if (fileCount === 0) {
    localModelStatus.textContent = '未選擇資料夾';
    isLocalModelLoaded = false;
    startTranscribeBtn.classList.add('disabled');
    return;
  }
  
  const hasConfig = selectedModelFiles['config.json'] !== undefined;
  
  if (!hasConfig) {
    showToast('錯誤：選取的資料夾中未找到 config.json，這可能不是有效的 Transformers 模型資料夾。', 'error');
    localModelStatus.textContent = `載入失敗：缺少 config.json`;
    localModelStatus.title = `載入失敗：缺少 config.json`;
    isLocalModelLoaded = false;
    startTranscribeBtn.classList.add('disabled');
    return;
  }
  
  localModelStatus.textContent = `已載入 ${fileCount} 個檔案`;
  localModelStatus.title = `包含 ${fileCount} 個檔案`;
  isLocalModelLoaded = true;
  showToast('本地自選模型目錄已解析完成！', 'success');
  
  if (selectedFile) {
    startTranscribeBtn.classList.remove('disabled');
  }
}

// Toast System
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'info';
  if (type === 'success') icon = 'check_circle';
  if (type === 'error') icon = 'error';
  
  toast.innerHTML = `
    <span class="material-symbols-rounded">${icon}</span>
    <span>${message}</span>
  `;
  
  toastContainer.appendChild(toast);
  
  // Slide out after 3.5s and remove
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Format Helper: Bytes to Human Readable
function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Get model cached state from localStorage
function isModelCached(modelId) {
  return localStorage.getItem(`whisper_model_${modelId}_cached`) === 'true';
}

// Refresh Model UI Elements
function refreshModelsUI() {
  const models = Object.values(MODEL_CONFIGS).map(model => ({
    ...model,
    downloaded: isModelCached(model.id)
  }));

  renderModelList(models);
  updateModelSelectDropdown(models);
}

// Render Model List Card
function renderModelList(models) {
  modelListContainer.innerHTML = '';
  
  models.forEach(model => {
    const item = document.createElement('div');
    item.className = `model-item ${model.downloaded ? 'downloaded' : ''}`;
    
    let actionHtml = '';
    if (model.downloaded) {
      actionHtml = `
        <span class="model-status-badge">
          <span class="material-symbols-rounded">check_circle</span>
          已就緒
        </span>
      `;
    } else {
      actionHtml = `
        <button class="btn btn-secondary btn-sm" onclick="triggerDownload('${model.id}')">
          <span class="material-symbols-rounded">download</span>
          下載 / 載入
        </button>
      `;
    }
    
    item.innerHTML = `
      <div class="model-info">
        <span class="model-name">${model.name}</span>
        <span class="model-size">大小: ${model.size}</span>
      </div>
      ${actionHtml}
    `;
    
    modelListContainer.appendChild(item);
  });
}

// Update settings dropdown select
function updateModelSelectDropdown(models) {
  const previousValue = selectModel.value;
  selectModel.innerHTML = '';
  
  models.forEach(model => {
    const option = document.createElement('option');
    option.value = model.id;
    const statusText = model.downloaded ? '已載入' : '待下載';
    option.textContent = `${model.name} (${statusText})`;
    if (model.id === 'tiny') option.selected = true;
    selectModel.appendChild(option);
  });
  
  // Restore previous selection if still available
  if (previousValue && models.some(m => m.id === previousValue)) {
    selectModel.value = previousValue;
  }
  
  if (selectedFile && selectModelSource.value === 'cdn') {
    startTranscribeBtn.classList.remove('disabled');
  }
}

// Multi-file loading progress callback for Transformers.js
const progressCallback = (data) => {
  if (data.status === 'initiate') {
    progressMap[data.file] = { loaded: 0, total: 0 };
  } else if (data.status === 'progress') {
    progressMap[data.file] = { loaded: data.loaded, total: data.total };
    
    // Calculate total size and loaded bytes
    let totalLoaded = 0;
    let totalSize = 0;
    for (const file in progressMap) {
      totalLoaded += progressMap[file].loaded;
      totalSize += progressMap[file].total;
    }
    
    const overallProgress = totalSize > 0 ? Math.round((totalLoaded / totalSize) * 100) : 0;
    
    showDownloadProgress({
      modelId: currentLoadingModelId,
      progress: overallProgress,
      downloadedBytes: totalLoaded,
      totalBytes: totalSize
    });
  } else if (data.status === 'done') {
    if (progressMap[data.file]) {
      progressMap[data.file].loaded = progressMap[data.file].total;
    }
  } else if (data.status === 'ready') {
    // Completed
  }
};

// Trigger Model Download / Initialization in browser Cache Storage
async function triggerDownload(modelId) {
  if (!isTransformersReady) {
    showToast('Transformers.js 尚未加載完成，請稍後...', 'error');
    return;
  }

  if (currentLoadingModelId) {
    showToast('另一個模型正在下載或載入中', 'error');
    return;
  }

  try {
    showToast(`開始載入 ${modelId.toUpperCase()} 模型，首次加載可能需要下載大檔案，請稍候...`, 'info');
    showDownloadProgress({
      modelId: modelId,
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0
    });
    
    currentLoadingModelId = modelId;
    progressMap = {};
    
    const config = MODEL_CONFIGS[modelId];
    await loadModelInWorker(modelId, config.path, 'cdn', {});
    
    currentModelId = modelId;
    localStorage.setItem(`whisper_model_${modelId}_cached`, 'true');
    
    refreshModelsUI();
    hideDownloadProgress();
    showToast(`${modelId.toUpperCase()} 模型已成功載入並快取！`, 'success');
  } catch (err) {
    console.error(err);
    showToast(`模型載入失敗: ${err.message}`, 'error');
    hideDownloadProgress();
  } finally {
    currentLoadingModelId = null;
  }
}

// Cancel Model Loading UI
function cancelDownload() {
  hideDownloadProgress();
  currentLoadingModelId = null;
  showToast('已取消下載/載入模型顯示（下載可能在背景快取中繼續）', 'info');
}

function showDownloadProgress(status) {
  downloadProgressBox.classList.remove('hidden');
  downloadingModelName.textContent = `正在載入 ${status.modelId.toUpperCase()} 模型...`;
  downloadPercentage.textContent = `${status.progress}%`;
  downloadProgressBar.style.width = `${status.progress}%`;
  
  const downloaded = formatBytes(status.downloadedBytes);
  const total = formatBytes(status.totalBytes);
  downloadBytesRatio.textContent = `${downloaded} / ${total}`;
}

function hideDownloadProgress() {
  downloadProgressBox.classList.add('hidden');
}

// Expose triggerDownload globally
window.triggerDownload = triggerDownload;

// Drag and Drop Logic
function initDragAndDrop() {
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      fileInput.files = files;
      handleFileSelect();
    }
  });
}

function handleFileSelect() {
  const file = fileInput.files[0];
  if (!file) return;
  
  selectedFile = file;
  
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  
  if (file.type.startsWith('video/')) {
    fileTypeIcon.textContent = 'video_file';
  } else {
    fileTypeIcon.textContent = 'audio_file';
  }
  
  dropZone.classList.add('hidden');
  fileInfo.classList.remove('hidden');
  
  const objectUrl = URL.createObjectURL(file);
  audioPlayer.src = objectUrl;
  audioPlayerBox.classList.remove('hidden');
  
  // Enable start button if a valid model path is ready
  if (selectModelSource.value === 'local' && isLocalModelLoaded) {
    startTranscribeBtn.classList.remove('disabled');
  } else if (selectModelSource.value === 'cdn' && selectModel.value) {
    startTranscribeBtn.classList.remove('disabled');
  }
  
  showToast(`已載入檔案: ${file.name}`, 'success');
}

function clearFile() {
  selectedFile = null;
  fileInput.value = '';
  audioPlayer.src = '';
  
  fileInfo.classList.add('hidden');
  audioPlayerBox.classList.add('hidden');
  dropZone.classList.remove('hidden');
  startTranscribeBtn.classList.add('disabled');
  
  resetResultView();
}

function resetResultView() {
  emptyResultState.classList.remove('hidden');
  resultTabsBox.classList.add('hidden');
  resultActionsBox.classList.add('hidden');
  currentSegments = [];
  timelineContainer.innerHTML = '';
  fulltextContainer.innerHTML = '';
}

// Convert Simplified Chinese characters to Traditional Chinese using S2T_MAP loaded from s2t.js
function convertS2T(text) {
  if (typeof S2T_MAP === 'undefined') {
    return text; // Fallback if mapping dictionary is not loaded
  }
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    result += S2T_MAP[char] || char;
  }
  return result;
}

// Decode Audio/Video File using Web Audio API and resample to 16kHz mono Float32Array
async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  
  let audioBuffer;
  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  } catch (err) {
    throw new Error('瀏覽器無法解碼此音訊檔案。請確認它是支援的格式。');
  } finally {
    audioContext.close();
  }
  
  const targetSampleRate = 16000;
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.round(audioBuffer.duration * targetSampleRate),
    targetSampleRate
  );
  
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start();
  
  const renderedBuffer = await offlineCtx.startRendering();
  return {
    audioData: renderedBuffer.getChannelData(0),
    duration: audioBuffer.duration
  };
}

// Start Speech-to-Text Transcription in Browser
async function startTranscription() {
  if (!selectedFile) return;
  
  const isLocal = selectModelSource.value === 'local';
  const modelId = isLocal ? 'local-model' : selectModel.value;
  
  if (!isLocal && !modelId) {
    showToast('請選擇 Whisper 執行模型', 'error');
    return;
  }
  
  if (isLocal && !isLocalModelLoaded) {
    showToast('請選取有效的本地模型資料夾', 'error');
    return;
  }

  if (!isTransformersReady) {
    showToast('Transformers.js 尚未載入完成，請稍後...', 'error');
    return;
  }
  
  // Setup loading state
  statusCard.classList.remove('hidden');
  resetResultView();
  
  startTranscribeBtn.classList.add('disabled');
  removeFileBtn.classList.add('disabled');
  
  setStepState('upload', 'active');
  let timerInterval = null;
  
  try {
    // Step 1: Upload (Instant since it is in-browser)
    await new Promise(resolve => setTimeout(resolve, 300));
    setStepState('upload', 'completed');
    
    // Step 2: Audio Decoding & Resampling (Web Audio API)
    setStepState('ffmpeg', 'active');
    const { audioData, duration } = await decodeAudioFile(selectedFile);
    setStepState('ffmpeg', 'completed');
    
    // Step 3: Whisper speech recognition
    setStepState('whisper', 'active');
    
    // Load model in Web Worker
    if (isLocal || currentModelId !== modelId) {
      const displayModelName = isLocal ? '本地選定' : modelId.toUpperCase();
      showToast(`載入 ${displayModelName} 模型中...`, 'info');
      showDownloadProgress({
        modelId: displayModelName,
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0
      });
      
      currentLoadingModelId = displayModelName;
      progressMap = {};
      
      const path = isLocal ? 'local-model' : MODEL_CONFIGS[modelId].path;
      await loadModelInWorker(modelId, path, selectModelSource.value, selectedModelFiles);
      
      currentModelId = modelId;
      if (!isLocal) {
        localStorage.setItem(`whisper_model_${modelId}_cached`, 'true');
        refreshModelsUI();
      }
      hideDownloadProgress();
    }
    
    const language = selectLanguage.value;
    const isTraditional = toggleTraditional.checked;
    
    // Options configuration
    const options = {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      task: 'transcribe'
    };
    
    if (language !== 'auto') {
      options.language = language === 'zh' ? 'chinese' : (language === 'en' ? 'english' : 'japanese');
    }
    
    // Start timing and ETA calculation
    const factor = getModelFactor(modelId);
    const estimatedTotalTime = Math.max(3, Math.round(duration * factor));
    
    let elapsedSeconds = 0;
    timerElapsed.textContent = '00:00';
    timerEta.textContent = formatTime(estimatedTotalTime);
    statusTimerBox.classList.remove('hidden');
    
    timerInterval = setInterval(() => {
      elapsedSeconds++;
      timerElapsed.textContent = formatTime(elapsedSeconds);
      
      const remaining = Math.round(estimatedTotalTime - elapsedSeconds);
      if (remaining > 0) {
        timerEta.textContent = formatTime(remaining);
      } else {
        timerEta.textContent = '即將完成...';
      }
    }, 1000);
    
    console.log(`Transcribing in Web Worker... Estimated time: ${estimatedTotalTime}s`);
    const result = await transcribeInWorker(audioData, options);
    console.log("Transcription result:", result);
    
    // Stop timer
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    statusTimerBox.classList.add('hidden');
    
    setStepState('whisper', 'completed');
    showToast('語音辨識完成！', 'success');
    
    // Format segments
    const formattedSegments = (result.chunks || []).map((chunk, idx) => {
      let text = chunk.text || '';
      text = text.trim();
      
      if (isTraditional && (language === 'zh' || language === 'auto')) {
        text = convertS2T(text);
      }
      
      return {
        id: idx,
        start: chunk.timestamp ? Math.round(chunk.timestamp[0] * 100) / 100 : 0,
        end: chunk.timestamp ? Math.round(chunk.timestamp[1] * 100) / 100 : 0,
        text: text
      };
    });
    
    const fullText = formattedSegments.map(s => s.text).join(' ');
    
    renderTranscript({
      segments: formattedSegments,
      fullText: fullText
    });
    
  } catch (err) {
    console.error(err);
    showToast(err.message || '語音轉文字失敗', 'error');
    resetResultView();
  } finally {
    if (timerInterval) {
      clearInterval(timerInterval);
    }
    statusTimerBox.classList.add('hidden');
    statusCard.classList.add('hidden');
    startTranscribeBtn.classList.remove('disabled');
    removeFileBtn.classList.remove('disabled');
    currentLoadingModelId = null;
  }
}

function setStepState(stepId, state) {
  const el = document.getElementById(`step-${stepId}`);
  if (!el) return;
  
  el.className = 'step';
  if (state === 'active') {
    el.classList.add('active');
  } else if (state === 'completed') {
    el.classList.add('completed');
  }
}

// Render Transcription Results
function renderTranscript(data) {
  emptyResultState.classList.add('hidden');
  resultTabsBox.classList.remove('hidden');
  resultActionsBox.classList.remove('hidden');
  
  currentSegments = data.segments || [];
  
  timelineContainer.innerHTML = '';
  
  if (currentSegments.length === 0) {
    timelineContainer.innerHTML = '<div class="empty-state">辨識結果為空</div>';
    fulltextContainer.textContent = data.fullText || '辨識結果為空';
    return;
  }
  
  currentSegments.forEach(seg => {
    const item = document.createElement('div');
    item.className = 'segment-item';
    item.setAttribute('data-start', seg.start);
    item.setAttribute('data-end', seg.end);
    
    item.addEventListener('click', () => {
      audioPlayer.currentTime = seg.start;
      audioPlayer.play();
    });
    
    item.innerHTML = `
      <span class="segment-timestamp">${formatTime(seg.start)}</span>
      <span class="segment-text">${escapeHtml(seg.text)}</span>
    `;
    
    timelineContainer.appendChild(item);
  });
  
  fulltextContainer.textContent = currentSegments.map(s => s.text).join('\n');
}

// Format time (seconds -> MM:SS or HH:MM:SS)
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  const pad = (num) => String(num).padStart(2, '0');
  
  if (h > 0) {
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
}

// Format SRT Subtitle Timestamp (HH:MM:SS,mmm)
function formatSrtTime(totalSeconds) {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  const ms = Math.floor((totalSeconds % 1) * 1000);

  const pad = (num, size = 2) => String(num).padStart(size, '0');

  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(ms, 3)}`;
}

// Escape HTML utility
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Tab navigation implementation
function initTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-button');
  
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      
      btn.classList.add('active');
      const targetTabId = btn.getAttribute('data-tab');
      document.getElementById(targetTabId).classList.add('active');
    });
  });
}

// Sync transcript scrolling / highlights with audio playback
function initPlaybackSync() {
  audioPlayer.addEventListener('timeupdate', () => {
    const currTime = audioPlayer.currentTime;
    const segmentElements = document.querySelectorAll('.segment-item');
    
    segmentElements.forEach(el => {
      const start = parseFloat(el.getAttribute('data-start'));
      const end = parseFloat(el.getAttribute('data-end'));
      
      if (currTime >= start && currTime <= end) {
        el.classList.add('active');
        
        if (document.querySelector('.tab-button[data-tab="timeline-tab"]').classList.contains('active')) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } else {
        el.classList.remove('active');
      }
    });
  });
}

// Export and Actions
function copyTranscriptText() {
  const text = fulltextContainer.innerText || fulltextContainer.textContent;
  if (!text) return;
  
  navigator.clipboard.writeText(text)
    .then(() => showToast('文字已複製到剪貼簿', 'success'))
    .catch(() => showToast('複製失敗', 'error'));
}

function exportAsTxt() {
  const text = fulltextContainer.innerText || fulltextContainer.textContent;
  if (!text) return;
  
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  const originalName = selectedFile ? selectedFile.name : 'transcript';
  const nameBase = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
  a.download = `${nameBase}_transcript.txt`;
  
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('TXT 檔案已匯出', 'success');
}

function exportAsSrt() {
  if (currentSegments.length === 0) return;
  
  let srtContent = '';
  currentSegments.forEach((seg, index) => {
    srtContent += `${index + 1}\n`;
    srtContent += `${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n`;
    srtContent += `${seg.text}\n\n`;
  });
  
  const blob = new Blob([srtContent], { type: 'text/srt;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  const originalName = selectedFile ? selectedFile.name : 'transcript';
  const nameBase = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
  a.download = `${nameBase}.srt`;
  
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('SRT 字幕檔案已匯出', 'success');
}
