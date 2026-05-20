// Global variables
let selectedFile = null;
let currentSegments = [];
let downloadedModels = [];
let pollingInterval = null;

// DOM Elements
const modelListContainer = document.getElementById('model-list-container');
const downloadProgressBox = document.getElementById('download-progress-box');
const downloadingModelName = document.getElementById('downloading-model-name');
const downloadPercentage = document.getElementById('download-percentage');
const downloadProgressBar = document.getElementById('download-progress-bar');
const downloadBytesRatio = document.getElementById('download-bytes-ratio');
const cancelDownloadBtn = document.getElementById('cancel-download-btn');

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
  fetchModels();
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
});

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

// Fetch Whisper Models Status
async function fetchModels() {
  try {
    const response = await fetch('/api/models');
    if (!response.ok) throw new Error('無法取得模型清單');
    
    const data = await response.json();
    downloadedModels = data.downloaded;
    
    renderModelList(data.available);
    updateModelSelectDropdown(data.available);
    
    // Check if downloading
    if (data.downloadStatus && data.downloadStatus.active) {
      showDownloadProgress(data.downloadStatus);
      startPollingDownload();
    } else {
      hideDownloadProgress();
      stopPollingDownload();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
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
          下載
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
  
  const downloaded = models.filter(m => m.downloaded);
  
  if (downloaded.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.disabled = true;
    option.selected = true;
    option.textContent = '請先在上方下載 model';
    selectModel.appendChild(option);
    startTranscribeBtn.classList.add('disabled');
    return;
  }
  
  downloaded.forEach(model => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    // Default select base or small if available
    if (model.id === 'base') option.selected = true;
    selectModel.appendChild(option);
  });
  
  // Restore previous selection if still available
  if (previousValue && downloaded.some(m => m.id === previousValue)) {
    selectModel.value = previousValue;
  }
  
  if (selectedFile) {
    startTranscribeBtn.classList.remove('disabled');
  }
}

// Trigger Model Download
async function triggerDownload(modelId) {
  try {
    const response = await fetch('/api/download-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId })
    });
    
    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || '啟動下載失敗');
    }
    
    showToast(`開始下載 ${modelId.toUpperCase()} 模型...`, 'info');
    fetchModels(); // Refresh status immediately
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Cancel Active Download
async function cancelDownload() {
  try {
    const response = await fetch('/api/cancel-download', { method: 'POST' });
    if (!response.ok) throw new Error('取消下載失敗');
    
    showToast('已取消下載模型', 'info');
    hideDownloadProgress();
    stopPollingDownload();
    fetchModels();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Download Polling System
function startPollingDownload() {
  if (pollingInterval) return;
  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/download-status');
      const status = await res.json();
      
      if (status.active) {
        showDownloadProgress(status);
      } else {
        stopPollingDownload();
        hideDownloadProgress();
        fetchModels(); // Refresh to show "Ready"
        if (status.status === 'completed') {
          showToast('模型下載成功，現在可以開始轉文字了！', 'success');
        } else if (status.status === 'error') {
          showToast(`模型下載失敗: ${status.error}`, 'error');
        }
      }
    } catch (e) {
      console.error('Polling error:', e);
    }
  }, 1000);
}

function stopPollingDownload() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

function showDownloadProgress(status) {
  downloadProgressBox.classList.remove('hidden');
  downloadingModelName.textContent = `正在下載 ${status.modelId.toUpperCase()} 模型...`;
  downloadPercentage.textContent = `${status.progress}%`;
  downloadProgressBar.style.width = `${status.progress}%`;
  
  const downloaded = formatBytes(status.downloadedBytes);
  const total = formatBytes(status.totalBytes);
  downloadBytesRatio.textContent = `${downloaded} / ${total}`;
}

function hideDownloadProgress() {
  downloadProgressBox.classList.add('hidden');
}

// Expose triggerDownload to window for inline onclick execution
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
      fileInput.files = files; // Assign to file input for uniformity
      handleFileSelect();
    }
  });
}

function handleFileSelect() {
  const file = fileInput.files[0];
  if (!file) return;
  
  selectedFile = file;
  
  // Render details
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  
  // Set appropriate icon
  if (file.type.startsWith('video/')) {
    fileTypeIcon.textContent = 'video_file';
  } else {
    fileTypeIcon.textContent = 'audio_file';
  }
  
  dropZone.classList.add('hidden');
  fileInfo.classList.remove('hidden');
  
  // Load file into local player
  const objectUrl = URL.createObjectURL(file);
  audioPlayer.src = objectUrl;
  audioPlayerBox.classList.remove('hidden');
  
  // Enable start button if model selected
  if (selectModel.value) {
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
  
  // Hide results too
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

// Start Speech-to-Text Transcription
async function startTranscription() {
  if (!selectedFile) return;
  const model = selectModel.value;
  if (!model) {
    showToast('請選擇 Whisper 執行模型', 'error');
    return;
  }
  
  // Setup loading state
  statusCard.classList.remove('hidden');
  resetResultView();
  
  // Disable interface
  startTranscribeBtn.classList.add('disabled');
  removeFileBtn.classList.add('disabled');
  
  // Steps tracking
  setStepState('upload', 'active');
  setStepState('ffmpeg', 'pending');
  setStepState('whisper', 'pending');
  
  const formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('model', model);
  formData.append('language', selectLanguage.value);
  formData.append('traditional', toggleTraditional.checked);
  
  // Simulate status steps on local server (approx timings for state display)
  setTimeout(() => {
    setStepState('upload', 'completed');
    setStepState('ffmpeg', 'active');
  }, 600);
  
  // We'll advance to whisper after a moment, assuming ffmpeg is fast on localhost
  let whisperTimer = setTimeout(() => {
    setStepState('ffmpeg', 'completed');
    setStepState('whisper', 'active');
  }, 2500);

  try {
    const response = await fetch('/api/transcribe', {
      method: 'POST',
      body: formData
    });
    
    // Clear the timer since we got the response or error
    clearTimeout(whisperTimer);
    
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || '語音轉文字失敗');
    }
    
    const result = await response.json();
    
    setStepState('upload', 'completed');
    setStepState('ffmpeg', 'completed');
    setStepState('whisper', 'completed');
    
    // Play complete sound or toast
    showToast('語音辨識完成！', 'success');
    
    // Display results
    renderTranscript(result);
    
  } catch (err) {
    showToast(err.message, 'error');
    resetResultView();
  } finally {
    // Hide status card
    statusCard.classList.add('hidden');
    // Enable interface
    startTranscribeBtn.classList.remove('disabled');
    removeFileBtn.classList.remove('disabled');
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
  
  // Render Timeline View
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
    
    // Timestamp click handler
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
  
  // Render Full Text View (with clean line breaks)
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
      // Remove active from all buttons & tabs
      tabButtons.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      
      // Add active to current
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
    
    let activeFound = false;
    
    segmentElements.forEach(el => {
      const start = parseFloat(el.getAttribute('data-start'));
      const end = parseFloat(el.getAttribute('data-end'));
      
      if (currTime >= start && currTime <= end) {
        // Highlight active segment
        el.classList.add('active');
        activeFound = true;
        
        // Auto scroll segment into view within the container
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
