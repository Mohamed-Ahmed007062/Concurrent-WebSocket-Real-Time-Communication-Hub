let socket = null;
let currentChannel = 'general';
let currentUserId = null;
let currentUsername = 'Developer_1';
let typingTimeout = null;
let pingInterval = null;

// DOM Elements
const inputUsername = document.getElementById('input-username');
const btnToggleConnect = document.getElementById('btn-toggle-connect');
const myAvatar = document.getElementById('my-avatar');
const myUsernameDisplay = document.getElementById('my-username-display');
const myUserIdDisplay = document.getElementById('my-userid-display');
const valPing = document.getElementById('val-ping');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const channelList = document.getElementById('channel-list');
const userList = document.getElementById('user-list');
const badgeUserCount = document.getElementById('badge-user-count');
const currentChannelTitle = document.getElementById('current-channel-title');
const currentChannelDesc = document.getElementById('current-channel-desc');
const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const btnSend = document.getElementById('btn-send');
const btnNewChannel = document.getElementById('btn-new-channel');
const typingIndicator = document.getElementById('typing-indicator');
const typingText = document.getElementById('typing-text');
const logsDrawer = document.getElementById('logs-drawer');
const btnViewLogs = document.getElementById('btn-view-logs');
const btnCloseLogs = document.getElementById('btn-close-logs');
const btnRefreshLogs = document.getElementById('btn-refresh-logs');
const logsContent = document.getElementById('logs-content');

// Initialize username from localStorage or random
const savedUsername = localStorage.getItem('chat_hub_username') || `Dev_${Math.floor(100 + Math.random() * 900)}`;
inputUsername.value = savedUsername;

// Connect / Disconnect Toggle
btnToggleConnect.addEventListener('click', () => {
  if (socket && socket.connected) {
    disconnectSocket();
  } else {
    connectSocket();
  }
});

function connectSocket() {
  const username = inputUsername.value.trim() || 'Guest';
  localStorage.setItem('chat_hub_username', username);
  currentUsername = username;

  btnToggleConnect.disabled = true;
  statusText.textContent = 'Connecting...';

  // Connect to Socket.io server with handshake auth
  socket = io({
    auth: { username },
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    statusDot.className = 'dot';
    statusText.textContent = 'Connected';
    btnToggleConnect.textContent = 'Disconnect';
    btnToggleConnect.className = 'btn btn-secondary';
    btnToggleConnect.disabled = false;
    messageInput.disabled = false;
    btnSend.disabled = false;

    myAvatar.textContent = username[0].toUpperCase();
    myUsernameDisplay.textContent = username;

    startPingMonitor();
    fetchChannels();
    fetchActiveUsers();
    addSystemMessage(`Connected to WebSocket Hub as "${username}"`);
  });

  socket.on('connect_error', (err) => {
    statusDot.className = 'dot status-offline';
    statusText.textContent = 'Connection Error';
    btnToggleConnect.disabled = false;
    btnToggleConnect.textContent = 'Connect';
    btnToggleConnect.className = 'btn btn-primary';
    addSystemMessage(`Connection error: ${err.message}`);
  });

  socket.on('disconnect', (reason) => {
    statusDot.className = 'dot status-offline';
    statusText.textContent = 'Disconnected';
    btnToggleConnect.textContent = 'Connect';
    btnToggleConnect.className = 'btn btn-primary';
    btnToggleConnect.disabled = false;
    messageInput.disabled = true;
    btnSend.disabled = true;
    valPing.textContent = '-- ms';
    stopPingMonitor();
    addSystemMessage(`Disconnected: ${reason}`);
  });

  // Incoming channel broadcast message
  socket.on('message:broadcast', (msg) => {
    if (msg.channel === currentChannel) {
      appendMessage(msg);
    }
  });

  // Incoming direct message
  socket.on('message:direct', (msg) => {
    appendMessage(msg, true);
  });

  // User presence update
  socket.on('user:presence_update', (data) => {
    addSystemMessage(`User ${data.username} is now ${data.status}`);
    fetchActiveUsers();
    fetchChannels();
  });

  // User joined/left channel
  socket.on('user:joined_channel', (data) => {
    if (data.channel === currentChannel) {
      addSystemMessage(`${data.user.username} joined #${data.channel}`);
      fetchChannels();
    }
  });

  socket.on('user:left_channel', (data) => {
    if (data.channel === currentChannel) {
      addSystemMessage(`${data.user.username} left #${data.channel}`);
      fetchChannels();
    }
  });

  // Typing indicator
  socket.on('typing:indicator', (data) => {
    if (data.channel === currentChannel || (data.recipientId && data.userId !== currentUserId)) {
      if (data.isTyping) {
        typingText.textContent = `${data.username} is typing...`;
        typingIndicator.style.display = 'flex';
      } else {
        typingIndicator.style.display = 'none';
      }
    }
  });

  // Error notifications
  socket.on('error:rate_limit', (data) => {
    addSystemMessage(`⚠️ Rate Limit Exceeded: ${data.message} (Retry after ${data.retryAfterMs}ms)`);
  });

  socket.on('error:validation', (data) => {
    addSystemMessage(`❌ Validation Error: ${data.message}`);
  });
}

function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// Full-Duplex Heartbeat Latency Tracking
function startPingMonitor() {
  stopPingMonitor();
  pingInterval = setInterval(() => {
    if (!socket || !socket.connected) return;
    const clientTimestamp = Date.now();
    socket.emit('heartbeat:ping', { clientTimestamp }, (res) => {
      if (res && typeof res.latencyMs === 'number') {
        valPing.textContent = `${res.latencyMs} ms`;
      }
    });
  }, 10000);
}

function stopPingMonitor() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

// Fetch channels from REST API
async function fetchChannels() {
  try {
    const res = await fetch('/api/channels');
    const data = await res.json();
    if (data.success && data.data && data.data.channels) {
      renderChannels(data.data.channels);
    }
  } catch (err) {
    console.error('Failed to load channels:', err);
  }
}

function renderChannels(channels) {
  channelList.innerHTML = '';
  channels.forEach((ch) => {
    const li = document.createElement('li');
    li.className = `channel-item ${ch.name === currentChannel ? 'active' : ''}`;
    li.innerHTML = `
      <span>#${ch.name}</span>
      <span class="channel-count">${ch.userCount}</span>
    `;
    li.addEventListener('click', () => switchChannel(ch.name));
    channelList.appendChild(li);
  });
}

// Switch channel
function switchChannel(newChannel) {
  if (!socket || !socket.connected || newChannel === currentChannel) return;

  const oldChannel = currentChannel;
  socket.emit('channel:leave', { channel: oldChannel });

  socket.emit('channel:join', { channel: newChannel }, (res) => {
    if (res.success) {
      currentChannel = newChannel;
      currentChannelTitle.textContent = `#${newChannel}`;
      currentChannelDesc.textContent = `Channel #${newChannel}`;
      messageInput.placeholder = `Message #${newChannel}... (or /dm <userId> <msg>)`;
      addSystemMessage(`Switched to #${newChannel}`);
      fetchChannels();
    }
  });
}

// Fetch active users cached in Redis
async function fetchActiveUsers() {
  try {
    const res = await fetch('/api/users/active');
    const data = await res.json();
    if (data.success && data.data) {
      const users = data.data.users || [];
      badgeUserCount.textContent = users.length;
      userList.innerHTML = '';

      if (users.length === 0) {
        userList.innerHTML = '<li class="empty-state">No users online</li>';
        return;
      }

      users.forEach((u) => {
        if (u.username === currentUsername && !currentUserId) {
          currentUserId = u.userId;
          myUserIdDisplay.textContent = `ID: ${u.userId}`;
        }

        const li = document.createElement('li');
        li.className = 'user-item';
        li.innerHTML = `
          <span class="online-indicator"></span>
          <span>${u.username}</span>
          ${u.userId === currentUserId ? '<span class="tag">You</span>' : ''}
        `;
        // Click to DM shortcut
        if (u.userId !== currentUserId) {
          li.style.cursor = 'pointer';
          li.title = `Click to direct message ${u.username} (${u.userId})`;
          li.addEventListener('click', () => {
            messageInput.value = `/dm ${u.userId} `;
            messageInput.focus();
          });
        }
        userList.appendChild(li);
      });
    }
  } catch (err) {
    console.error('Failed to load active users:', err);
  }
}

// Create or join custom channel
btnNewChannel.addEventListener('click', () => {
  const name = prompt('Enter channel name (letters, numbers, underscores):');
  if (name && name.trim()) {
    switchChannel(name.trim().toLowerCase());
  }
});

// Send Message
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const rawText = messageInput.value.trim();
  if (!rawText || !socket || !socket.connected) return;

  // Direct message command syntax: /dm <userId> <content>
  if (rawText.startsWith('/dm ')) {
    const parts = rawText.slice(4).trim().split(' ');
    const recipientId = parts[0];
    const content = parts.slice(1).join(' ');

    if (!recipientId || !content) {
      addSystemMessage('Usage: /dm <recipientUserId> <message text>');
      return;
    }

    socket.emit('message:direct', { recipientId, content }, (res) => {
      if (!res.success) {
        addSystemMessage(`❌ Direct message failed: ${res.error}`);
      }
    });
  } else {
    // Channel message
    socket.emit('message:channel', { channel: currentChannel, content: rawText }, (res) => {
      if (!res.success) {
        addSystemMessage(`❌ Failed to send: ${res.error}`);
      }
    });
  }

  messageInput.value = '';
  socket.emit('typing:stop', { channel: currentChannel });
});

// Typing indicator detection
messageInput.addEventListener('input', () => {
  if (!socket || !socket.connected) return;
  socket.emit('typing:start', { channel: currentChannel });

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing:stop', { channel: currentChannel });
  }, 1500);
});

// Message Rendering
function appendMessage(msg, isDirect = false) {
  const isMine = msg.senderUsername === currentUsername || msg.senderId === currentUserId;
  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isMine ? 'mine' : ''} ${isDirect ? 'direct' : ''}`;

  const timeStr = new Date(msg.timestamp).toLocaleTimeString();

  bubble.innerHTML = `
    <div class="message-header">
      <span class="message-sender">${escapeHtml(msg.senderUsername)} ${isDirect ? '🔒 (Direct)' : ''}</span>
      <span class="message-time">${timeStr}</span>
    </div>
    <div class="message-content">${escapeHtml(msg.content)}</div>
    <div class="message-footer">Tx: ${msg.transactionId.slice(0, 8)}... | ${msg.id.slice(0, 8)}...</div>
  `;

  messagesContainer.appendChild(bubble);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addSystemMessage(text) {
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble system';
  bubble.innerHTML = `<span>${escapeHtml(text)}</span>`;
  messagesContainer.appendChild(bubble);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Persistent Audit Logs Viewer
btnViewLogs.addEventListener('click', () => {
  logsDrawer.classList.toggle('open');
  if (logsDrawer.classList.contains('open')) {
    loadAuditLogs();
  }
});

btnCloseLogs.addEventListener('click', () => {
  logsDrawer.classList.remove('open');
});

btnRefreshLogs.addEventListener('click', () => {
  loadAuditLogs();
});

async function loadAuditLogs() {
  try {
    logsContent.innerHTML = '<div class="log-empty">Loading audit logs from disk store...</div>';
    const res = await fetch('/api/logs/transactions?limit=30');
    const data = await res.json();

    if (data.success && data.data && data.data.transactions) {
      const logs = data.data.transactions;
      if (logs.length === 0) {
        logsContent.innerHTML = '<div class="log-empty">No transactions logged on disk yet.</div>';
        return;
      }

      logsContent.innerHTML = '';
      logs.forEach((log) => {
        const item = document.createElement('div');
        item.className = `log-entry ${log.status === 'RATE_LIMITED' ? 'rate-limit' : ''}`;
        item.innerHTML = `
          <div class="log-time">${new Date(log.timestamp).toISOString()}</div>
          <div><span class="log-event">[${log.event}]</span> Target: #${log.target || 'none'}</div>
          <div>User: ${escapeHtml(log.senderUsername || 'system')} | Status: ${log.status}</div>
          <div class="log-id">TxID: ${log.transactionId}</div>
        `;
        logsContent.appendChild(item);
      });
    }
  } catch (err) {
    logsContent.innerHTML = `<div class="log-empty">Error reading logs: ${err.message}</div>`;
  }
}

// Initial fetch on page load
fetchChannels();
fetchActiveUsers();

