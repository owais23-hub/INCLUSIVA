function bufToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  function base64ToBuf(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = binary.charCodeAt(i);
    return arr.buffer;
  }
  function generateSalt(len = 16) {
    const salt = crypto.getRandomValues(new Uint8Array(len));
    return bufToBase64(salt.buffer);
  }
  async function deriveKeyPBKDF2(password, saltBase64, iterations = 150000, dkLen = 32) {
    const saltBuffer = base64ToBuf(saltBase64);
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations }, key, dkLen * 8);
    return bufToBase64(derived);
  }
  function constantTimeEqual(a, b) {
    try {
      const A = new Uint8Array(base64ToBuf(a));
      const B = new Uint8Array(base64ToBuf(b));
      if (A.length !== B.length) return false;
      let diff = 0;
      for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
      return diff === 0;
    } catch (e) { return false; }
  }
  const DB = {
    init() {
      if (!localStorage.getItem('INCLUSIVA_events')) localStorage.setItem('INCLUSIVA_events', JSON.stringify([]));
      if (!localStorage.getItem('INCLUSIVA_users')) localStorage.setItem('INCLUSIVA_users', JSON.stringify([]));
      if (!localStorage.getItem('INCLUSIVA_registrations')) localStorage.setItem('INCLUSIVA_registrations', JSON.stringify([]));
      if (!localStorage.getItem('INCLUSIVA_comments')) localStorage.setItem('INCLUSIVA_comments', JSON.stringify([]));
      if (!localStorage.getItem('INCLUSIVA_failed_logins')) localStorage.setItem('INCLUSIVA_failed_logins', JSON.stringify({}));
      if (localStorage.getItem('INCLUSIVA_theme') === 'dark') document.body.classList.add('dark-mode');
      if (!localStorage.getItem('INCLUSIVA_dms')) {
        localStorage.setItem('INCLUSIVA_dms', JSON.stringify([]));
      }
      this.migrateFromLegacyStorage();

    },

    migrateFromLegacyStorage() {
      const legacyKeys = [
        'events', 'users', 'registrations', 'comments', 'failed_logins', 'theme'
      ];

      legacyKeys.forEach(key => {
        const legacyValue = localStorage.getItem(key);
        if (legacyValue) {
          localStorage.setItem('INCLUSIVA_' + key, legacyValue);
          localStorage.removeItem(key);
        }
      });
    },
    getEvents() { return JSON.parse(localStorage.getItem('INCLUSIVA_events') || '[]'); },
    addEvent(ev) { const events = this.getEvents(); ev.id = Date.now().toString(); events.push(ev); localStorage.setItem('INCLUSIVA_events', JSON.stringify(events)); return ev; },
    deleteEvent(id) {
      let events = this.getEvents(); const idx = events.findIndex(e => e.id === id); if (idx === -1) return false; events.splice(idx, 1); localStorage.setItem('INCLUSIVA_events', JSON.stringify(events));
      let regs = this.getRegistrations(); regs = regs.filter(r => r.eventId !== id); localStorage.setItem('INCLUSIVA_registrations', JSON.stringify(regs));
      let coms = this.getComments(); coms = coms.filter(c => c.eventId !== id); localStorage.setItem('INCLUSIVA_comments', JSON.stringify(coms));
      return true;
    },
    getUsers() { return JSON.parse(localStorage.getItem('INCLUSIVA_users') || '[]'); },
    setUsers(users) { localStorage.setItem('INCLUSIVA_users', JSON.stringify(users)); },
    addUser(user) {
      const users = this.getUsers();
      if (users.some(u => u.username === user.username)) return { success: false, message: 'Username already exists' };
      if (users.some(u => (u.email || '').toLowerCase() === (user.email || '').toLowerCase())) return { success: false, message: 'Email already registered' };
      user.profilePicture = user.profilePicture || '';
      user.about = user.about || '';

      users.push(user);
      localStorage.setItem('INCLUSIVA_users', JSON.stringify(users));
      return { success: true, user };
    },
    updateUser(username, updates) {
      const users = this.getUsers();
      const userIndex = users.findIndex(u => u.username === username);
      if (userIndex === -1) return false;
      users[userIndex] = { ...users[userIndex], ...updates };
      this.setUsers(users);
      return true;
    },
    getUserByEmail(email) { const users = this.getUsers(); return users.find(u => (u.email || '').toLowerCase() === (email || '').toLowerCase()); },
    deleteUser(username) {
      let users = this.getUsers(); const idx = users.findIndex(u => u.username === username); if (idx === -1) return false; const removed = users.splice(idx, 1); this.setUsers(users); // remove regs/comments/events by user
      let regs = this.getRegistrations(); regs = regs.filter(r => r.userId !== username); localStorage.setItem('INCLUSIVA_registrations', JSON.stringify(regs));
      let coms = this.getComments(); coms = coms.filter(c => c.userId !== username); localStorage.setItem('INCLUSIVA_comments', JSON.stringify(coms));
      const events = this.getEvents(); const toDelete = events.filter(e => e.institution === username).map(e => e.id); toDelete.forEach(id => this.deleteEvent(id));
      return removed[0];
    },
    getRegistrations() { return JSON.parse(localStorage.getItem('INCLUSIVA_registrations') || '[]'); },
    addRegistration(reg) { const regs = this.getRegistrations(); regs.push(reg); localStorage.setItem('INCLUSIVA_registrations', JSON.stringify(regs)); return reg; },
    getComments() { return JSON.parse(localStorage.getItem('INCLUSIVA_comments') || '[]'); },
    addComment(c) { const coms = this.getComments(); c.id = Date.now().toString(); coms.push(c); localStorage.setItem('INCLUSIVA_comments', JSON.stringify(coms)); return c; },
    deleteComment(id) { let coms = this.getComments(); const idx = coms.findIndex(c => c.id === id); if (idx === -1) return false; coms.splice(idx, 1); localStorage.setItem('INCLUSIVA_comments', JSON.stringify(coms)); return true; }
    , getConversations: function (userId) {
      const dms = this.getDMs();
      const conversations = {};
//JSON
      dms.forEach(dm => {
        if (dm.senderId === userId || dm.receiverId === userId) {
          const otherUserId = dm.senderId === userId ? dm.receiverId : dm.senderId;
          if (!conversations[otherUserId]) {
            conversations[otherUserId] = {
              userId: otherUserId,
              lastMessage: dm.content,
              timestamp: dm.timestamp,
              unread: 0
            };
          } else if (new Date(dm.timestamp) > new Date(conversations[otherUserId].timestamp)) {
            conversations[otherUserId].lastMessage = dm.content;
            conversations[otherUserId].timestamp = dm.timestamp;
          }
        }
      });

      return Object.values(conversations).sort((a, b) =>
        new Date(b.timestamp) - new Date(a.timestamp)
      );
    },

    getMessages: function (userId, otherUserId) {
      const dms = this.getDMs();
      return dms.filter(dm =>
        (dm.senderId === userId && dm.receiverId === otherUserId) ||
        (dm.senderId === otherUserId && dm.receiverId === userId)
      ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    },

    addDM: function (dm) {
      const dms = this.getDMs();
      dm.id = Date.now().toString();
      dm.timestamp = new Date().toISOString();
      dms.push(dm);
      localStorage.setItem('INCLUSIVA_dms', JSON.stringify(dms));
      return dm;
    },

    getDMs: function () {
      return JSON.parse(localStorage.getItem('INCLUSIVA_dms') || '[]');
    }

  };
  DB.init();
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('sidebarDmBtn').addEventListener('click', (e) => {
      e.preventDefault();
      showDmPage();
      sidebar.classList.remove('open');
    });

    document.getElementById('sidebarSearchBtn').addEventListener('click', (e) => {
      e.preventDefault();
      showSearchPage();
      sidebar.classList.remove('open');
    });

    document.getElementById('backFromDm').addEventListener('click', () => showMainPage());
    document.getElementById('backFromSearch').addEventListener('click', () => showMainPage());
    function renderDmPage() {
      if (!currentUser) return;
      const dmContacts = DB.getConversations(currentUser.username);
      const dmContactList = document.getElementById('dmContactList');
      dmContactList.innerHTML = '';

      if (dmContacts.length === 0) {
        dmContactList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">No conversations yet</div>';
      } else {
        dmContacts.forEach(contact => {
          const user = DB.getUsers().find(u => u.username === contact.userId);
          if (!user) return;

          const li = document.createElement('li');
          li.className = 'dm-contact';
          li.setAttribute('data-userid', user.username);
          li.innerHTML = `
                  <div class="dm-contact-avatar">
                      ${user.profilePicture ? `<img src="${user.profilePicture}" alt="${user.username}">` : user.username[0] || 'U'}
                  </div>
                  <div class="dm-contact-info">
                      <div class="dm-contact-name">${user.username}</div>
                      <div class="dm-contact-preview">${contact.lastMessage || 'Start a conversation'}</div>
                  </div>
              `;
          dmContactList.appendChild(li);
        });
      }
      document.querySelectorAll('.dm-contact').forEach(contact => {
        contact.addEventListener('click', () => {
          const userId = contact.getAttribute('data-userid');
          selectDmContact(userId);
        });
      });
    }

    function selectDmContact(userId) {
      if (!currentUser) return;

      const user = DB.getUsers().find(u => u.username === userId);
      if (!user) return;
      document.querySelectorAll('.dm-contact').forEach(c => {
        c.classList.remove('active');
        if (c.getAttribute('data-userid') === userId) {
          c.classList.add('active');
        }
      });

      const dmCurrentAvatar = document.getElementById('dmCurrentAvatar');
      const dmCurrentName = document.getElementById('dmCurrentName');

      dmCurrentAvatar.innerHTML = user.profilePicture ?
        `<img src="${user.profilePicture}" alt="${user.username}">` :
        user.username[0] || 'U';
      dmCurrentName.textContent = user.username;
      const dmMessageInput = document.getElementById('dmMessageInput');
      const dmSendButton = document.getElementById('dmSendButton');
      dmMessageInput.disabled = false;
      dmSendButton.disabled = false;
      loadDmMessages(userId);
    }

    function loadDmMessages(userId) {
      if (!currentUser) return;

      const messages = DB.getMessages(currentUser.username, userId);
      const dmMessagesContent = document.getElementById('dmMessagesContent');
      dmMessagesContent.innerHTML = '';

      if (messages.length === 0) {
        dmMessagesContent.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">No messages yet. Start a conversation!</div>';
        return;
      }

      messages.forEach(msg => {
        const isSent = msg.senderId === currentUser.username;
        const messageDiv = document.createElement('div');
        messageDiv.className = `dm-message ${isSent ? 'sent' : 'received'}`;
        messageDiv.innerHTML = `
              <div>${msg.content}</div>
              <div class="dm-message-time">${formatTime(msg.timestamp)}</div>
          `;
        dmMessagesContent.appendChild(messageDiv);
      });
      dmMessagesContent.scrollTop = dmMessagesContent.scrollHeight;
    }

    function sendDmMessage() {
      const currentUser = window.currentUser;
      const currentDmContact = window.currentDmContact;

      if (!currentUser || !currentDmContact) return;

      const dmMessageInput = document.getElementById('dmMessageInput');
      const message = dmMessageInput.value.trim();
      if (!message) return;
      DB.addDM({
        senderId: currentUser.username,
        receiverId: currentDmContact,
        content: message
      });
      dmMessageInput.value = '';
      loadDmMessages(currentDmContact);
      renderDmPage();
    }
    function renderSearchPage() {
      const userSearchResults = document.getElementById('userSearchResults');
      const userSearchInput = document.getElementById('userSearchInput');

      userSearchResults.innerHTML = '';
      userSearchInput.value = '';
      userSearchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        if (searchTerm.length < 2) {
          userSearchResults.innerHTML = '';
          return;
        }

        const users = DB.getUsers().filter(user =>
          user.username.toLowerCase().includes(searchTerm) ||
          (user.email && user.email.toLowerCase().includes(searchTerm)) ||
          (user.about && user.about.toLowerCase().includes(searchTerm))
        );

        displaySearchResults(users);
      });
    }

    function displaySearchResults(users) {
      const userSearchResults = document.getElementById('userSearchResults');
      userSearchResults.innerHTML = '';

      if (users.length === 0) {
        userSearchResults.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">No users found</div>';
        return;
      }

      users.forEach(user => {
        if (user.username === window.currentUser.username) return;

        const resultDiv = document.createElement('div');
        resultDiv.className = 'search-result';
        resultDiv.setAttribute('data-userid', user.username);
        resultDiv.innerHTML = `
              <div class="search-result-avatar">
                  ${user.profilePicture ? `<img src="${user.profilePicture}" alt="${user.username}">` : user.username[0] || 'U'}
              </div>
              <div class="search-result-info">
                  <div class="search-result-name">${user.username}</div>
                  <div class="search-result-email">${user.email || 'No email'}</div>
                  <div class="search-result-type">${user.type}</div>
              </div>
          `;
        userSearchResults.appendChild(resultDiv);
      });
      document.querySelectorAll('.search-result').forEach(result => {
        result.addEventListener('click', () => {
          const userId = result.getAttribute('data-userid');
          const user = DB.getUsers().find(u => u.username === userId);
          if (user) {
            alert(`Viewing profile of ${user.username}`);
          }
        });
      });
    }
    document.getElementById('changeProfileImageBtn')?.addEventListener('click', () => {
      document.getElementById('profileImageInput').click();
    });

    document.getElementById('profileImageInput')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        alert('Please se  lect an image file');
        return;
      }

      try {
        const dataUrl = await readFileAsDataURL(file);
        window.profileImageFile = file;
        document.getElementById('profileAvatarInitial').style.display = 'none';
        const profileAvatarImg = document.getElementById('profileAvatarImg');
        profileAvatarImg.style.display = 'block';
        profileAvatarImg.src = dataUrl;
      } catch (err) {
        console.error('Error reading image:', err);
        alert('Error reading image file');
      }
    });
    document.getElementById('profileEditForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (!window.currentUser) return;

      try {
        let profilePicture = '';
        if (window.profileImageFile) {
          profilePicture = await readFileAsDataURL(window.profileImageFile);
        }

        const updates = {
          about: document.getElementById('profileAbout').value,
          ...(profilePicture && { profilePicture })
        };

        const success = DB.updateUser(window.currentUser.username, updates);
        if (success) {
          alert('Profile updated successfully!');
          hideProfileEditModal();
          renderProfile();
        } else {
          alert('Error updating profile');
        }
      } catch (err) {
        console.error('Error updating profile:', err);
        alert('Error updating profile');
      }
    });
    function formatTime(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  });
  const FAILED_KEY = 'INCLUSIVA_failed_logins';
  function loadFailedMap() { return JSON.parse(localStorage.getItem(FAILED_KEY) || '{}'); }
  function saveFailedMap(map) { localStorage.setItem(FAILED_KEY, JSON.stringify(map)); }
  function recordFailedAttempt(email) { const e = (email || '').toLowerCase(); if (!e) return; const map = loadFailedMap(); const now = Date.now(); if (!map[e]) map[e] = { count: 0, lastFailedAt: 0, lockedUntil: 0 }; map[e].count = (map[e].count || 0) + 1; map[e].lastFailedAt = now; if (map[e].count >= 5) map[e].lockedUntil = now + (15 * 60 * 1000); saveFailedMap(map); }
  function resetFailedAttempts(email) { const e = (email || '').toLowerCase(); if (!e) return; const map = loadFailedMap(); if (map[e]) { delete map[e]; saveFailedMap(map); } }
  function canAttemptLogin(email) { const e = (email || '').toLowerCase(); if (!e) return true; const map = loadFailedMap(); const info = map[e]; if (!info) return true; const now = Date.now(); if (info.lockedUntil && now < info.lockedUntil) return false; return true; }
  function getLockoutRemaining(email) { const e = (email || '').toLowerCase(); const map = loadFailedMap(); const info = map[e]; if (!info || !info.lockedUntil) return 0; const rem = info.lockedUntil - Date.now(); return rem > 0 ? rem : 0; }
  function passwordStrength(password) {
    const checks = {
      length: password.length >= 8,
      lower: /[a-z]/.test(password),
      upper: /[A-Z]/.test(password),
      digit: /[0-9]/.test(password),
      special: /[^A-Za-z0-9]/.test(password)
    };
    const score = Object.values(checks).reduce((s, v) => s + (v ? 1 : 0), 0);
    let message = 'Weak';
    if (score <= 2) message = 'Weak — use 8+ chars, mix upper/lower/digits/symbols';
    else if (score === 3) message = 'Fair — add more variety (uppercase, digits, symbols)';
    else if (score === 4) message = 'Good — consider adding a symbol';
    else if (score === 5) message = 'Strong';
    return { score, checks, message };
  }
  function generateSessionToken(len = 24) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    let s = '';
    for (let i = 0; i < arr.length; i++) s += ('0' + arr[i].toString(16)).slice(-2);
    return s;
  }
  function createSession(username, role, ttlMillis = 1000 * 60 * 60 * 4) { const token = generateSessionToken(24); const session = { username, role, token, expiresAt: Date.now() + ttlMillis }; localStorage.setItem('INCLUSIVA_session', JSON.stringify(session)); return session; }
  function clearSession() { localStorage.removeItem('INCLUSIVA_session'); }
  function loadSession() { try { return JSON.parse(localStorage.getItem('INCLUSIVA_session') || 'null'); } catch (e) { return null; } }
  async function verifyPasswordForUser(plainPassword, userRecord) {
    if (!userRecord) return false;
    if (userRecord.passwordHash && userRecord.salt) {
      try {
        const derived = await deriveKeyPBKDF2(plainPassword, userRecord.salt, userRecord.iterations || 150000, 32);
        return constantTimeEqual(derived, userRecord.passwordHash);
      } catch (e) { console.error('verify error', e); return false; }
    }
    if (userRecord.password) {
      if (userRecord.password === plainPassword) {
        try {
          const salt = generateSalt();
          const iterations = 150000;
          const derived = await deriveKeyPBKDF2(plainPassword, salt, iterations, 32);
          const users = DB.getUsers(); const idx = users.findIndex(u => u.username === userRecord.username);
          if (idx > -1) { users[idx].salt = salt; users[idx].passwordHash = derived; users[idx].iterations = iterations; delete users[idx].password; DB.setUsers(users); }
        } catch (e) { console.error('migration error', e); }
        return true;
      }
    }
    return false;
  }
  const authSection = document.getElementById('authSection');
  const mainContent = document.getElementById('mainContent');
  const eventsColumn = document.getElementById('eventsColumn');
  const pagination = document.getElementById('pagination');
  const sidebar = document.getElementById('sidebar');
  const eventPage = document.getElementById('eventPage');
  const eventDetailContent = document.getElementById('eventDetailContent');
  const profilePage = document.getElementById('profilePage');
  const profileContent = document.getElementById('profileContent');
  const adminProfilePage = document.getElementById('adminProfilePage');
  const adminProfileContent = document.getElementById('adminProfileContent');
  const myEventsPage = document.getElementById('myEventsPage');
  const myEventsColumn = document.getElementById('myEventsColumn');
  const eventCreationPage = document.getElementById('eventCreationPage');
  const eventForm = document.getElementById('eventForm');
  const imageUploadButton = document.getElementById('imageUploadButton');
  const imageInput = document.getElementById('imageInput');
  const imageUploadContainer = document.getElementById('imageUploadContainer');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalConfirmBtn = document.getElementById('modalConfirmBtn');
  const modalCancelBtn = document.getElementById('modalCancelBtn');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const authTabs = document.querySelectorAll('.auth-tab');
  const authTabSlider = document.getElementById('authTabSlider');
  const adminUsersList = document.getElementById('adminUsersList');
  const adminEventsList = document.getElementById('adminEventsList');
  const profileEditModal = document.getElementById('profileEditModal');
  const profileEditForm = document.getElementById('profileEditForm');
  const profileAbout = document.getElementById('profileAbout');
  const profileImageInput = document.getElementById('profileImageInput');
  const changeProfileImageBtn = document.getElementById('changeProfileImageBtn');
  const profileEditCancel = document.getElementById('profileEditCancel');
  const profileAvatarPreview = document.getElementById('profileAvatarPreview');
  const profileAvatarInitial = document.getElementById('profileAvatarInitial');
  const profileAvatarImg = document.getElementById('profileAvatarImg');
  const dmPage = document.getElementById('dmPage');
  const dmContactList = document.getElementById('dmContactList');
  const dmContactSearch = document.getElementById('dmContactSearch');
  const dmMessagesContent = document.getElementById('dmMessagesContent');
  const dmMessageInput = document.getElementById('dmMessageInput');
  const dmSendButton = document.getElementById('dmSendButton');
  const dmCurrentContact = document.getElementById('dmCurrentContact');
  const dmCurrentAvatar = document.getElementById('dmCurrentAvatar');
  const dmCurrentName = document.getElementById('dmCurrentName');
  const searchPage = document.getElementById('searchPage');
  const userSearchInput = document.getElementById('userSearchInput');
  const userSearchResults = document.getElementById('userSearchResults');
  let currentUser = null;
  let currentPage = 1;
  const eventsPerPage = 10;
  let eventImages = [];
  let eventFiles = [];
  let thumbnailIndex = -1;
  let modalConfirmCallback = null;
  let profileImageFile = null;
  document.getElementById('themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    if (document.body.classList.contains('dark-mode')) localStorage.setItem('INCLUSIVA_theme', 'dark'); else localStorage.setItem('INCLUSIVA_theme', 'light');
  });
  authTabs.forEach((tab, idx) => {
    tab.addEventListener('click', () => {
      authTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      authTabSlider.style.transform = `translateX(${idx * 100}%)`;
      showAuthForm(tab.getAttribute('data-tab'));
    });
  });
  function showAuthForm(tab) {
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    if (tab === 'student') document.getElementById('studentLoginForm').classList.add('active');
    else if (tab === 'institution') document.getElementById('institutionLoginForm').classList.add('active');
    else document.getElementById('adminLoginForm').classList.add('active');
  }
  function showOnlyForm(formId) {
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    const el = document.getElementById(formId); if (el) el.classList.add('active');
    const map = { studentLoginForm: 'student', studentRegisterForm: 'student', institutionLoginForm: 'institution', institutionRegisterForm: 'institution', adminLoginForm: 'admin', adminRegisterForm: 'admin' };
    const tabName = map[formId] || 'student';
    authTabs.forEach(t => t.classList.remove('active'));
    const theTab = Array.from(authTabs).find(t => t.getAttribute('data-tab') === tabName);
    if (theTab) theTab.classList.add('active');
    const idx = Array.from(authTabs).indexOf(theTab);
    authTabSlider.style.transform = `translateX(${idx * 100}%)`;
  }
  function showError(input, message) {
    if (!input) return;
    const group = input.parentElement;
    const msg = group.querySelector('.form-message');
    group.classList.add('error'); group.classList.remove('success');
    if (msg) { msg.textContent = message; msg.classList.add('error'); msg.classList.remove('success'); }
  }
  function showSuccess(input, message = 'Looks good!') {
    if (!input) return;
    const group = input.parentElement;
    const msg = group.querySelector('.form-message');
    group.classList.remove('error'); group.classList.add('success');
    if (msg) { msg.textContent = message; msg.classList.add('success'); msg.classList.remove('error'); }
  }
  function resetValidation(input) {
    if (!input) return;
    const group = input.parentElement;
    const msg = group.querySelector('.form-message');
    group.classList.remove('error', 'success');
    if (msg) { msg.textContent = ''; msg.classList.remove('error', 'success'); }
  }
  function showDmPage() {
    authSection.style.display = 'none';
    mainContent.style.display = 'none';
    eventPage.style.display = 'none';
    profilePage.style.display = 'none';
    adminProfilePage.style.display = 'none';
    myEventsPage.style.display = 'none';
    eventCreationPage.style.display = 'none';
    document.getElementById('adminUsersPage').style.display = 'none';
    document.getElementById('adminEventsPage').style.display = 'none';
    searchPage.style.display = 'none';
    dmPage.style.display = 'block';
    document.getElementById('sidebarToggle').style.display = 'flex';
    renderDmPage();
  }

  function showSearchPage() {
    authSection.style.display = 'none';
    mainContent.style.display = 'none';
    eventPage.style.display = 'none';
    profilePage.style.display = 'none';
    adminProfilePage.style.display = 'none';
    myEventsPage.style.display = 'none';
    eventCreationPage.style.display = 'none';
    document.getElementById('adminUsersPage').style.display = 'none';
    document.getElementById('adminEventsPage').style.display = 'none';
    dmPage.style.display = 'none';
    searchPage.style.display = 'block';
    document.getElementById('sidebarToggle').style.display = 'flex';
    renderSearchPage();
  }
  document.querySelectorAll('input').forEach(i => i.addEventListener('input', () => resetValidation(i)));
  document.getElementById('studentRegisterBtn').addEventListener('click', async () => {
    const usernameEl = document.getElementById('studentRegisterUsername');
    const emailEl = document.getElementById('studentRegisterEmail');
    const passwordEl = document.getElementById('studentRegisterPassword');
    const strengthEl = document.getElementById('studentPasswordStrength');
    resetValidation(usernameEl); resetValidation(emailEl); resetValidation(passwordEl);
    const username = (usernameEl.value || '').trim();
    const email = (emailEl.value || '').trim().toLowerCase();
    const password = passwordEl.value || '';
    let ok = true;

    if (!username) { showError(usernameEl, 'Username required'); ok = false; }
    if (!email || !(/\S+@\S+\.\S+/.test(email))) { showError(emailEl, 'Valid email required'); ok = false; }
    const strength = passwordStrength(password);
    strengthEl.textContent = strength.message;
    if (strength.score < 4) { showError(passwordEl, 'Password not strong enough'); ok = false; } else showSuccess(passwordEl);
    if (!ok) return;

    if (!window.crypto || !window.crypto.subtle) {
      alert("Secure registration requires HTTPS or localhost.");
      return;
    }

    if (DB.getUsers().some(u => u.username === username)) { showError(usernameEl, 'Username already exists'); return; }
    if (DB.getUsers().some(u => (u.email || '').toLowerCase() === email)) { showError(emailEl, 'Email registered'); return; }

    try {
      const salt = generateSalt();
      const iterations = 150000;
      const derived = await deriveKeyPBKDF2(password, salt, iterations, 32);
      const user = { username, email, type: 'student', createdAt: new Date().toISOString(), passwordHash: derived, salt, iterations, profilePicture: '', about: '' };
      const res = DB.addUser(user);
      if (!res.success) { alert('Registration failed: ' + res.message); return; }
      alert('Registered successfully! Please login.');
      document.getElementById('studentRegisterForm').reset();
      strengthEl.textContent = '';
      showOnlyForm('studentLoginForm');
    } catch (e) {
      console.error("Registration error", e);
      alert('Registration failed due to a security issue.');
    }
  });
  document.getElementById('studentLoginBtn').addEventListener('click', async () => {
    const emailEl = document.getElementById('studentLoginEmail');
    const passEl = document.getElementById('studentLoginPassword');
    const email = (emailEl.value || '').trim().toLowerCase();
    const password = passEl.value || '';
    resetValidation(emailEl); resetValidation(passEl);
    if (!email || !(/^\S+@\S+\.\S+$/.test(email))) { showError(emailEl, 'Valid email required'); return; }
    if (!password) { showError(passEl, 'Password required'); return; }
    if (!canAttemptLogin(email)) { const remaining = getLockoutRemaining(email); alert('Too many failed attempts. Try again in ' + Math.ceil(remaining / 60000) + ' minutes.'); return; }
    const user = DB.getUserByEmail(email);
    if (!user) { recordFailedAttempt(email); showError(emailEl, 'Invalid credentials'); showError(passEl, 'Invalid credentials'); return; }
    if (user.type !== 'student') {
      recordFailedAttempt(email);
      showError(emailEl, 'Not a student account');
      showError(passEl, 'Invalid credentials');
      return;
    }
    try {
      const ok = await verifyPasswordForUser(password, user);
      if (!ok) { recordFailedAttempt(email); showError(emailEl, 'Invalid credentials'); showError(passEl, 'Invalid credentials'); return; }
      resetFailedAttempts(email);
      loginUser(user.type, user.username, user.email);
      document.getElementById('studentLoginForm').reset();
    } catch (e) { console.error(e); alert('Login error'); }
  });
  document.getElementById('institutionRegisterBtn').addEventListener('click', async () => {
    const usernameEl = document.getElementById('institutionRegisterUsername');
    const emailEl = document.getElementById('institutionRegisterEmail');
    const passwordEl = document.getElementById('institutionRegisterPassword');
    const strengthEl = document.getElementById('institutionPasswordStrength');
    resetValidation(usernameEl); resetValidation(emailEl); resetValidation(passwordEl);
    const username = (usernameEl.value || '').trim();
    const email = (emailEl.value || '').trim().toLowerCase();
    const password = passwordEl.value || '';
    let ok = true;

    if (!username) { showError(usernameEl, 'Institution name required'); ok = false; }
    if (!email || !(/\S+@\S+\.\S+/.test(email))) { showError(emailEl, 'Valid email required'); ok = false; }
    const strength = passwordStrength(password);
    strengthEl.textContent = strength.message;
    if (strength.score < 4) { showError(passwordEl, 'Password not strong enough'); ok = false; } else showSuccess(passwordEl);
    if (!ok) return;

    if (!window.crypto || !window.crypto.subtle) {
      alert("Secure registration requires HTTPS or localhost.");
      return;
    }

    if (DB.getUsers().some(u => u.username === username)) { showError(usernameEl, 'Institution exists'); return; }
    if (DB.getUsers().some(u => (u.email || '').toLowerCase() === email)) { showError(emailEl, 'Email registered'); return; }

    try {
      const salt = generateSalt();
      const iterations = 150000;
      const derived = await deriveKeyPBKDF2(password, salt, iterations, 32);
      const user = { username, email, type: 'institution', createdAt: new Date().toISOString(), passwordHash: derived, salt, iterations, profilePicture: '', about: '' };
      const res = DB.addUser(user);
      if (!res.success) { alert('Registration failed: ' + res.message); return; }
      alert('Institution registered successfully! Please login.');
      document.getElementById('institutionRegisterForm').reset();
      strengthEl.textContent = '';
      showOnlyForm('institutionLoginForm');
    } catch (e) {
      console.error("Institution registration error", e);
      alert('Institution registration failed due to a security issue.');
    }
  });
  document.getElementById('institutionLoginBtn').addEventListener('click', async () => {
    const emailEl = document.getElementById('institutionLoginEmail');
    const passEl = document.getElementById('institutionLoginPassword');
    const email = (emailEl.value || '').trim().toLowerCase();
    const password = passEl.value || '';
    resetValidation(emailEl); resetValidation(passEl);
    if (!email || !(/^\S+@\S+\.\S+$/.test(email))) { showError(emailEl, 'Valid email required'); return; }
    if (!password) { showError(passEl, 'Password required'); return; }
    if (!canAttemptLogin(email)) { const remaining = getLockoutRemaining(email); alert('Too many failed attempts. Try again in ' + Math.ceil(remaining / 60000) + ' minutes.'); return; }
    const user = DB.getUserByEmail(email);
    if (!user) { recordFailedAttempt(email); showError(emailEl, 'Invalid credentials'); showError(passEl, 'Invalid credentials'); return; }
    if (user.type !== 'institution') {
      recordFailedAttempt(email);
      showError(emailEl, 'Not an institution account');
      showError(passEl, 'Invalid credentials');
      return;
    }
    try {
      const ok = await verifyPasswordForUser(password, user);
      if (!ok) { recordFailedAttempt(email); showError(emailEl, 'Invalid credentials'); showError(passEl, 'Invalid credentials'); return; }
      resetFailedAttempts(email);
      loginUser(user.type, user.username, user.email);
      document.getElementById('institutionLoginForm').reset();
    } catch (e) { console.error(e); alert('Login error'); }
  });
  document.getElementById('adminRegisterBtn').addEventListener('click', async () => {
    const usernameEl = document.getElementById('adminRegisterUsername');
    const emailEl = document.getElementById('adminRegisterEmail');
    const passwordEl = document.getElementById('adminRegisterPassword');
    const strengthEl = document.getElementById('adminPasswordStrength');
    resetValidation(usernameEl); resetValidation(emailEl); resetValidation(passwordEl);
    const username = (usernameEl.value || '').trim();
    const email = (emailEl.value || '').trim().toLowerCase();
    const password = passwordEl.value || '';
    let ok = true;

    if (!username) { showError(usernameEl, 'Admin username required'); ok = false; }
    if (!email || !(/\S+@\S+\.\S+/.test(email))) { showError(emailEl, 'Valid email required'); ok = false; }
    const strength = passwordStrength(password);
    strengthEl.textContent = strength.message;
    if (strength.score < 4) { showError(passwordEl, 'Password not strong enough'); ok = false; } else showSuccess(passwordEl);
    if (!ok) return;

    if (!window.crypto || !window.crypto.subtle) {
      alert("Secure registration requires HTTPS or localhost.");
      return;
    }

    if (DB.getUsers().some(u => u.username === username)) { showError(usernameEl, 'Username exists'); return; }
    if (DB.getUsers().some(u => (u.email || '').toLowerCase() === email)) { showError(emailEl, 'Email registered'); return; }

    try {
      const salt = generateSalt();
      const iterations = 150000;
      const derived = await deriveKeyPBKDF2(password, salt, iterations, 32);
      const user = { username, email, type: 'admin', createdAt: new Date().toISOString(), passwordHash: derived, salt, iterations, profilePicture: '', about: '' };
      const res = DB.addUser(user);
      if (!res.success) { alert('Registration failed: ' + res.message); return; }
      alert('Admin account created! Please login.');
      document.getElementById('adminRegisterForm').reset();
      strengthEl.textContent = '';
      showOnlyForm('adminLoginForm');
    } catch (e) {
      console.error("Admin registration error", e);
      alert('Admin registration failed due to a security issue.');
    }
  });
  document.getElementById('adminLoginBtn').addEventListener('click', async () => {
    const emailEl = document.getElementById('adminLoginEmail');
    const passEl = document.getElementById('adminLoginPassword');
    const email = (emailEl.value || '').trim().toLowerCase();
    const password = passEl.value || '';
    resetValidation(emailEl); resetValidation(passEl);
    if (!email || !(/^\S+@\S+\.\S+$/.test(email))) { showError(emailEl, 'Valid email required'); return; }
    if (!password) { showError(passEl, 'Password required'); return; }
    if (!canAttemptLogin(email)) { const remaining = getLockoutRemaining(email); alert('Too many failed attempts. Try again in ' + Math.ceil(remaining / 60000) + ' minutes.'); return; }
    const user = DB.getUserByEmail(email);
    if (!user) { recordFailedAttempt(email); showError(emailEl, 'Invalid credentials'); showError(passEl, 'Invalid credentials'); return; }
    if (user.type !== 'admin') {
      recordFailedAttempt(email);
      showError(emailEl, 'Not an admin account');
      showError(passEl, 'Invalid credentials');
      return;
    }
    try {
      const ok = await verifyPasswordForUser(password, user);
      if (!ok) { recordFailedAttempt(email); showError(emailEl, 'Invalid credentials'); showError(passEl, 'Invalid credentials'); return; }
      resetFailedAttempts(email);
      loginUser(user.type, user.username, user.email);
      document.getElementById('adminLoginForm').reset();
    } catch (e) { console.error(e); alert('Login error'); }
  });
  function readFileAsDataURL(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
  imageUploadButton.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (eventFiles.length + files.length > 10) { alert('Max 10 images'); imageInput.value = ''; return; }
    try {
      for (const file of files) {
        eventFiles.push(file);
        const url = await readFileAsDataURL(file);
        eventImages.push(url);
        if (thumbnailIndex === -1) thumbnailIndex = 0;
        addImagePreview(url, eventImages.length - 1);
      }
    } catch (err) { console.error(err); alert('Error reading images'); }
    imageInput.value = '';
  });
  function addImagePreview(imageData, index) {
    const div = document.createElement('div'); div.className = 'image-preview'; if (index === thumbnailIndex) div.classList.add('thumbnail');
    div.innerHTML = `<img src="${imageData}" alt="Event image"><div class="thumbnail-indicator">Thumbnail</div><button type="button" class="set-thumbnail-btn" data-index="${index}">Set as Thumbnail</button><div class="remove-image" title="Remove image">&times;</div>`;
    div.querySelector('.remove-image').addEventListener('click', (ev) => { ev.stopPropagation(); const imgs = Array.from(document.querySelectorAll('.image-preview img')); const src = div.querySelector('img').src; const idx = imgs.findIndex(i => i.src === src); if (idx > -1) { eventImages.splice(idx, 1); eventFiles.splice(idx, 1); if (thumbnailIndex === idx) thumbnailIndex = eventImages.length > 0 ? 0 : -1; else if (idx < thumbnailIndex) thumbnailIndex--; } div.remove(); rebuildPreviews(); });
    div.querySelector('.set-thumbnail-btn').addEventListener('click', (ev) => { ev.stopPropagation(); const idx = parseInt(ev.currentTarget.getAttribute('data-index'), 10); if (!isNaN(idx)) { thumbnailIndex = idx; updateThumbnailIndicators(); } });
    imageUploadContainer.insertBefore(div, imageUploadButton);
    updateThumbnailIndicators();
  }
  function rebuildPreviews() { document.querySelectorAll('.image-preview').forEach(p => p.remove()); eventImages.forEach((img, idx) => addImagePreview(img, idx)); updateThumbnailIndicators(); }
  function updateThumbnailIndicators() { document.querySelectorAll('.image-preview').forEach((preview, idx) => { const btn = preview.querySelector('.set-thumbnail-btn'); if (btn) btn.setAttribute('data-index', idx); if (idx === thumbnailIndex) preview.classList.add('thumbnail'); else preview.classList.remove('thumbnail'); }); }
  function clearImagePreviews() { document.querySelectorAll('.image-preview').forEach(e => e.remove()); eventImages = []; eventFiles = []; thumbnailIndex = -1; }
  document.getElementById('sidebarToggle').addEventListener('click', () => sidebar.classList.add('open'));
  document.getElementById('closeSidebar').addEventListener('click', () => sidebar.classList.remove('open'));
  document.getElementById('sidebarHome').addEventListener('click', (e) => { e.preventDefault(); showMainPage(); sidebar.classList.remove('open'); });
  document.getElementById('sidebarProfileBtn').addEventListener('click', (e) => {
    e.preventDefault();
    sidebar.classList.remove('open'); if (currentUser && currentUser.type === 'admin') showAdminProfilePage(); else showProfilePage();
  });
  document.getElementById('sidebarMyEventsBtn').addEventListener('click', (e) => { e.preventDefault(); showMyEventsPage(); sidebar.classList.remove('open'); });
  document.getElementById('sidebarCreateEvent').addEventListener('click', (e) => { e.preventDefault(); showEventCreationPage(); sidebar.classList.remove('open'); });
  document.getElementById('sidebarManageUsers').addEventListener('click', (e) => { e.preventDefault(); showAdminUsersPage(); sidebar.classList.remove('open'); });
  document.getElementById('sidebarManageEvents').addEventListener('click', (e) => { e.preventDefault(); showAdminEventsPage(); sidebar.classList.remove('open'); });

  document.getElementById('gotoManageUsers')?.addEventListener('click', () => showAdminUsersPage());
  document.getElementById('gotoManageEvents')?.addEventListener('click', () => showAdminEventsPage());

  document.getElementById('backFromEvent').addEventListener('click', () => showMainPage());
  document.getElementById('backFromProfile').addEventListener('click', () => showMainPage());
  document.getElementById('backFromMyEvents').addEventListener('click', () => showMainPage());
  document.getElementById('backFromEventCreation').addEventListener('click', () => showMainPage());
  document.getElementById('backFromAdminUsers').addEventListener('click', () => showMainPage());
  document.getElementById('backFromAdminEvents').addEventListener('click', () => showMainPage());
  document.getElementById('backFromAdminProfile')?.addEventListener('click', () => showMainPage());

  document.getElementById('homeLink').addEventListener('click', (e) => { e.preventDefault(); showMainPage(); });

  document.getElementById('addEventBtn').addEventListener('click', () => showEventCreationPage());
  eventForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser || currentUser.type !== 'institution') { alert('You must be logged in as an institution to create events.'); return; }
    try {
      if (eventFiles.length > 0) {
        const dataUrls = await Promise.all(eventFiles.map(f => readFileAsDataURL(f)));
        eventImages = dataUrls.slice();
      }
    } catch (err) { console.error(err); alert('Error processing images'); return; }
    const newEvent = {
      title: document.getElementById('eventTitle').value,
      description: document.getElementById('eventDescription').value,
      date: document.getElementById('eventDate').value,
      time: document.getElementById('eventTime').value,
      location: document.getElementById('eventLocation').value,
      contact: document.getElementById('eventContact').value,
      images: eventImages.slice(),
      thumbnailIndex: thumbnailIndex,
      institution: currentUser.username || currentUser.email || 'Unknown',
      category: document.getElementById('eventCategory').value
    };
    if (newEvent.images && newEvent.images.length > 0 && (newEvent.thumbnailIndex === undefined || newEvent.thumbnailIndex < 0 || newEvent.thumbnailIndex >= newEvent.images.length)) newEvent.thumbnailIndex = 0;
    DB.addEvent(newEvent);
    eventForm.reset(); clearImagePreviews(); renderEvents(); showMainPage(); alert('Event created successfully!');
  });
  document.getElementById('logoutBtn').addEventListener('click', (e) => { e.preventDefault(); currentUser = null; clearSession(); showAuthPage(); sidebar.classList.remove('open'); document.querySelectorAll('.institution-only').forEach(el => el.classList.add('hidden')); document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden')); document.getElementById('sidebarToggle').style.display = 'none'; });
  function showAuthPage() {
    authSection.style.display = 'flex';
    mainContent.style.display = 'none';
    eventPage.style.display = 'none';
    profilePage.style.display = 'none';
    adminProfilePage.style.display = 'none';
    myEventsPage.style.display = 'none';
    eventCreationPage.style.display = 'none';
    document.getElementById('adminUsersPage').style.display = 'none';
    document.getElementById('adminEventsPage').style.display = 'none';
    document.getElementById('addEventBtn').style.display = 'none';
    document.getElementById('sidebarToggle').style.display = 'none';
    showOnlyForm('studentLoginForm');
  }
  function showMainPage() {
    authSection.style.display = 'none';
    mainContent.style.display = 'block';
    eventPage.style.display = 'none';
    profilePage.style.display = 'none';
    adminProfilePage.style.display = 'none';
    myEventsPage.style.display = 'none';
    eventCreationPage.style.display = 'none';
    document.getElementById('adminUsersPage').style.display = 'none';
    document.getElementById('adminEventsPage').style.display = 'none';
    document.getElementById('addEventBtn').style.display = (currentUser && currentUser.type === 'institution') ? 'block' : 'none';
    document.getElementById('sidebarToggle').style.display = 'flex';
    renderEvents();
  }
  function showEventPage(eventId) {
    authSection.style.display = 'none';
    mainContent.style.display = 'none';
    eventPage.style.display = 'block';
    profilePage.style.display = 'none';
    adminProfilePage.style.display = 'none';
    myEventsPage.style.display = 'none';
    eventCreationPage.style.display = 'none';
    document.getElementById('adminUsersPage').style.display = 'none';
    document.getElementById('adminEventsPage').style.display = 'none';
    document.getElementById('sidebarToggle').style.display = 'flex';
    renderEventDetail(eventId);
  }
  function showProfilePage() {
    authSection.style.display = 'none';
    mainContent.style.display = 'none';
    eventPage.style.display = 'none';
    profilePage.style.display = 'block';
    adminProfilePage.style.display = 'none';
    myEventsPage.style.display = 'none';
    eventCreationPage.style.display = 'none';
    document.getElementById('adminUsersPage').style.display = 'none';
    document.getElementById('adminEventsPage').style.display = 'none';
    document.getElementById('sidebarToggle').style.display = 'flex';
    renderProfile();
  }
  function showAdminProfilePage() {
    authSection.style.display = 'none';
    mainContent.style.display = 'none';
    eventPage.style.display = 'none';
    profilePage.style.display = 'none';
    adminProfilePage.style.display = 'block';
    myEventsPage.style.display = 'none';
    eventCreationPage.style.display = 'none';
    document.getElementById('adminUsersPage').style.display = 'none';
    document.getElementById('adminEventsPage').style.display = 'none';
    document.getElementById('sidebarToggle').style.display = 'flex';
    renderAdminProfile();
  }
  function showMyEventsPage() {
    authSection.style.display = 'none';
    mainContent.style.display = 'none';
    eventPage.style.display = 'none';
    profilePage.style.display = 'none';
    adminProfilePage.style.display = 'none';
    myEventsPage.style.display = 'block';
    eventCreationPage.style.display = 'none';
    document.getElementById('adminUsersPage').style.display = 'none';
    document.getElementById('adminEventsPage').style.display = 'none';
    document.getElementById('sidebarToggle').style.display = 'flex';
    renderMyEvents();
  }
  function showEventCreationPage() {
    authSection.style.display = 'none';
    mainContent.style.display = 'none';
    eventPage.style.display = 'none';
    profilePage.style.display = 'none';
    adminProfilePage.style.display = 'none';
    myEventsPage.style.display = 'none';
    eventCreationPage.style.display = 'block';
    document.getElementById('adminUsersPage').style.display = 'none';
    document.getElementById('adminEventsPage').style.display = 'none';
    document.getElementById('sidebarToggle').style.display = 'flex';
  }
  function showAdminUsersPage() {
    authSection.style.display = 'none';
    mainContent.style.display = 'none';
    eventPage.style.display = 'none';
    profilePage.style.display = 'none';
    adminProfilePage.style.display = 'none';
    myEventsPage.style.display = 'none';
    eventCreationPage.style.display = 'none';
    document.getElementById('adminUsersPage').style.display = 'block';
    document.getElementById('adminEventsPage').style.display = 'none';
    document.getElementById('sidebarToggle').style.display = 'flex';
    renderAdminUsers();
  }
  function showAdminEventsPage() {
    authSection.style.display = 'none';
    mainContent.style.display = 'none';
    eventPage.style.display = 'none';
    profilePage.style.display = 'none';
    adminProfilePage.style.display = 'none';
    myEventsPage.style.display = 'none';
    eventCreationPage.style.display = 'none';
    document.getElementById('adminUsersPage').style.display = 'none';
    document.getElementById('adminEventsPage').style.display = 'block';
    document.getElementById('sidebarToggle').style.display = 'flex';
    renderAdminEvents();
  }
  function loginUser(type, username, email) {
    currentUser = { type, username, email };
    createSession(username, type);
    document.querySelectorAll('.institution-only').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    if (type === 'institution') document.querySelectorAll('.institution-only').forEach(el => el.classList.remove('hidden'));
    if (type === 'admin') document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    if (type === 'admin') {
      document.getElementById('addEventBtn').style.display = 'none';
      document.querySelectorAll('.institution-only').forEach(el => el.classList.add('hidden'));
    }
    document.getElementById('sidebarToggle').style.display = 'flex';
    showMainPage();
  }
  function renderEvents() {
    eventsColumn.innerHTML = '';
    const events = DB.getEvents();
    const start = (currentPage - 1) * eventsPerPage;
    const end = Math.min(start + eventsPerPage, events.length);
    const pageEvents = events.slice(start, end);
    if (pageEvents.length === 0) {
      eventsColumn.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted);"><i class="fas fa-calendar-plus fa-3x" style="margin-bottom:12px;"></i><h3>No Events Yet</h3><p>Check back later for upcoming events.</p></div>`;
    } else {
      pageEvents.forEach(ev => {
        const card = document.createElement('div'); card.className = 'event-card'; card.setAttribute('data-id', ev.id);
        let color = '#6366f1';
        switch (ev.category) { case 'Technology': color = '#6366f1'; break; case 'Science': color = '#10b981'; break; case 'Business': color = '#f59e0b'; break; case 'Arts': color = '#ec4899'; break; case 'Sports': color = '#ef4444'; break; case 'Education': color = '#8b5cf6'; break; default: color = '#6366f1'; }
        let imageHTML = '';
        if (ev.images && ev.images.length > 0) { const ti = (ev.thumbnailIndex !== undefined ? ev.thumbnailIndex : 0); const safeIdx = (ti >= 0 && ti < ev.images.length) ? ti : 0; imageHTML = `<img src="${ev.images[safeIdx]}" alt="${ev.title}">`; }
        else imageHTML = `<i class="fas fa-calendar-day fa-2x" style="color:#fff;"></i>`;
        card.innerHTML = `<div class="event-image" style="background:${color};">${imageHTML}<div class="event-category">${ev.category}</div></div><div class="event-content"><h3 class="event-title">${ev.title}</h3><div class="event-details"><p><i class="fas fa-university"></i> ${ev.institution}</p><p><i class="fas fa-map-marker-alt"></i> ${ev.location}</p><p><i class="fas fa-clock"></i> ${ev.time}</p></div><p>${(ev.description || '').substring(0, 120)}.</p><div class="event-footer"><span>Click for details</span><div class="event-date">${formatDate(ev.date)}</div></div></div>`;
        eventsColumn.appendChild(card);
      });
    }
    document.querySelectorAll('.event-card').forEach(card => card.addEventListener('click', (e) => {
      const id = card.getAttribute('data-id');
      showEventPage(id);
    }));
    renderPagination(DB.getEvents().length);
  }
  function renderMyEvents() {
    myEventsColumn.innerHTML = '';
    const events = DB.getEvents();
    const mine = events.filter(e => e.institution === (currentUser ? currentUser.username : ''));
    if (mine.length === 0) {
      myEventsColumn.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted);"><i class="fas fa-calendar-plus fa-3x" style="margin-bottom:12px;"></i><h3>No Events Created Yet</h3><p>Click the + button to create your first event.</p></div>`;
      return;
    }
    mine.forEach(ev => {
      const card = document.createElement('div'); card.className = 'event-card'; card.setAttribute('data-id', ev.id);
      let color = '#6366f1'; switch (ev.category) { case 'Technology': color = '#6366f1'; break; case 'Science': color = '#10b981'; break; case 'Business': color = '#f59e0b'; break; case 'Arts': color = '#ec4899'; break; case 'Sports': color = '#ef4444'; break; case 'Education': color = '#8b5cf6'; break; }
      const img = ev.images && ev.images.length > 0 ? `<img src="${ev.images[ev.thumbnailIndex || 0]}" alt="${ev.title}">` : `<i class="fas fa-calendar-day fa-2x" style="color:#fff;"></i>`;
      card.innerHTML = `<div class="event-image" style="background:${color};">${img}<div class="event-category">${ev.category}</div></div><div class="event-content"><h3 class="event-title">${ev.title}</h3><div class="event-details"><p><i class="fas fa-calendar"></i> ${ev.date} | ${ev.time}</p><p><i class="fas fa-map-marker-alt"></i> ${ev.location}</p></div><p>${(ev.description || '').substring(0, 100)}.</p><div style="display:flex;align-items:center;gap:8px;"><div class="event-date">${formatDate(ev.date)}</div><button class="delete-event-btn" data-id="${ev.id}" title="Delete Event"><i class="fas fa-trash"></i></button></div></div>`;
      myEventsColumn.appendChild(card);
    });
    document.querySelectorAll('#myEventsColumn .event-card').forEach(card => card.addEventListener('click', (e) => { if (e.target.closest('.delete-event-btn')) return; const id = card.getAttribute('data-id'); showEventPage(id); }));
    document.querySelectorAll('.delete-event-btn').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); const id = btn.getAttribute('data-id'); const ev = DB.getEvents().find(x => x.id === id); showConfirmModal('Delete event', `Delete "${(ev && ev.title) || 'this event'}"? This cannot be undone.`, () => { const ok = DB.deleteEvent(id); if (ok) { alert('Event deleted.'); renderMyEvents(); renderEvents(); } else alert('Could not delete event.'); }); }));
  }
  function renderPagination(totalEvents) {
    pagination.innerHTML = '';
    const totalPages = Math.max(1, Math.ceil(totalEvents / eventsPerPage));
    const createPageButton = (label, page, opts = {}) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (opts.disabled) b.disabled = true;
      if (opts.active) b.classList.add('active');
      b.addEventListener('click', () => {
        if (page === currentPage) return;
        currentPage = page;
        renderEvents();
        window.scrollTo({ top: 120, behavior: 'smooth' });
      });
      return b;
    };
    if (currentPage > 1) {
      const prev = createPageButton('«', Math.max(1, currentPage - 1));
      pagination.appendChild(prev);
    } else {
      pagination.appendChild(createPageButton('«', 1, { disabled: true }));
    }
    for (let i = 1; i <= totalPages; i++) {
      pagination.appendChild(createPageButton(String(i), i, { active: i === currentPage }));
    }
    if (currentPage < totalPages) {
      pagination.appendChild(createPageButton('»', Math.min(totalPages, currentPage + 1)));
    } else {
      pagination.appendChild(createPageButton('»', totalPages, { disabled: true }));
    }
  }
  function renderEventDetail(eventId) {
    const ev = DB.getEvents().find(e => e.id === eventId);
    if (!ev) { eventDetailContent.innerHTML = '<p>Event not found.</p>'; return; }
    let color = '#6366f1';
    switch (ev.category) { case 'Technology': color = '#6366f1'; break; case 'Science': color = '#10b981'; break; case 'Business': color = '#f59e0b'; break; case 'Arts': color = '#ec4899'; break; case 'Sports': color = '#ef4444'; break; case 'Education': color = '#8b5cf6'; break; }
    let large = ev.images && ev.images.length > 0 ? `<img src="${ev.images[(ev.thumbnailIndex || 0)]}" alt="${ev.title}">` : `<i class="fas fa-calendar-day fa-3x" style="color:#fff;"></i>`;
    let galleryHTML = '';
    if (ev.images && ev.images.length > 0) galleryHTML = `<div class="image-gallery">${ev.images.map(i => `<div class="gallery-image"><img src="${i}" alt="Event image"></div>`).join('')}</div>`;
    const isOwner = currentUser && currentUser.type === 'institution' && currentUser.username === ev.institution;
    const isAdmin = currentUser && currentUser.type === 'admin';
    const commentsForEvent = DB.getComments().filter(c => c.eventId === ev.id).sort((a, b) => Number(a.id) - Number(b.id));
    const commentsListHTML = commentsForEvent.map(c => {
      const canDelete = currentUser && (currentUser.username === c.userId || currentUser.type === 'admin');
      return `<div class="comment-row" data-comment-id="${c.id}"><div class="comment-avatar">${(c.username && c.username[0]) || 'U'}</div><div class="comment-body"><div class="comment-meta">${escapeHtml(c.username)} <span style="opacity:.7">(${escapeHtml(c.role)})</span> • <span class="small-muted">${new Date(c.createdAt).toLocaleString()}</span></div><div class="comment-text">${escapeHtml(c.content)}</div>${canDelete ? `<div class="comment-actions"><button class="comment-delete" data-comment-id="${c.id}">Delete</button></div>` : ''}</div></div>`;
    }).join('');
    eventDetailContent.innerHTML = `<div class="event-header"><div class="event-image-large" style="background:${color};">${large}</div><div class="event-info"><h2 class="event-title-large">${ev.title}</h2><p class="small-muted"><i class="fas fa-university"></i> ${ev.institution}</p><p class="small-muted"><i class="fas fa-calendar"></i> ${ev.date} | ${ev.time}</p><p class="small-muted"><i class="fas fa-map-marker-alt"></i> ${ev.location}</p><p class="small-muted"><i class="fas fa-envelope"></i> ${ev.contact || ''}</p><p class="small-muted"><i class="fas fa-tag"></i> ${ev.category}</p></div></div><div class="event-description"><h3>About this event</h3><p>${ev.description}</p></div>${galleryHTML}<div style="margin-top:16px;" class="register-section"><h3>Registration</h3><p id="registerStatus">${isRegisteredFor(currentUser ? currentUser.username : null, ev.id) ? 'You are already registered for this event.' : 'Click to register.'}</p><div style="display:flex;gap:8px;margin-top:8px;"><button id="registerBtn" class="btn btn-primary" ${isRegisteredFor(currentUser ? currentUser.username : null, ev.id) ? 'disabled' : ''}><i class="fas fa-ticket-alt"></i> ${isRegisteredFor(currentUser ? currentUser.username : null, ev.id) ? 'Registered' : 'Register for this Event'}</button>${(isOwner || isAdmin) ? `<button id="deleteEventDetailBtn" class="btn btn-secondary" style="margin-left:12px;"><i class="fas fa-trash"></i> Delete Event</button>` : ''}</div></div>
              <div class="comments-section" id="commentsSection"><h3>Comments (${commentsForEvent.length})</h3>${currentUser ? `<div class="comment-form" style="margin-top:8px;"><textarea id="commentInput" placeholder="Write your comment..."></textarea><div style="display:flex;justify-content:flex-end;margin-top:8px;"><button id="postCommentBtn" class="btn btn-primary">Post Comment</button></div></div>` : `<div class="small-muted">Please login to post comments.</div>`}<div id="commentsList" style="margin-top:12px;">${commentsListHTML || '<div class="small-muted">No comments yet.</div>'}</div></div>`;
    const regBtn = document.getElementById('registerBtn');
    if (regBtn) {
      regBtn.addEventListener('click', () => {
        if (!currentUser || currentUser.type !== 'student') { alert('Please login as a student to register.'); showAuthPage(); return; }
        DB.addRegistration({ eventId: ev.id, userId: currentUser.username, registeredAt: new Date().toISOString() });
        regBtn.disabled = true; regBtn.innerHTML = '<i class="fas fa-check"></i> Registered'; document.getElementById('registerStatus').textContent = 'You are already registered for this event.'; alert('Registered!');
      });
    }
    const delBtn = document.getElementById('deleteEventDetailBtn');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        showConfirmModal('Delete event', `Delete "${ev.title}"? This cannot be undone.`, () => {
          const ok = DB.deleteEvent(ev.id);
          if (ok) { alert('Event deleted.'); showMainPage(); renderEvents(); } else alert('Could not delete event.');
        });
      });
    }
    const postBtn = document.getElementById('postCommentBtn');
    if (postBtn) {
      postBtn.addEventListener('click', () => {
        const input = document.getElementById('commentInput');
        const text = (input.value || '').trim();
        if (!text) return alert('Comment cannot be empty.');
        if (!currentUser) return alert('Please login to comment.');
        const comment = { eventId: ev.id, userId: currentUser.username, username: currentUser.username, role: currentUser.type, content: text, createdAt: new Date().toISOString() };
        DB.addComment(comment);
        input.value = '';
        renderEventDetail(ev.id);
      });
    }
    document.querySelectorAll('.comment-delete').forEach(btn => btn.addEventListener('click', (e) => {
      const cid = btn.getAttribute('data-comment-id');
      const com = DB.getComments().find(c => c.id === cid);
      if (!com) return alert('Comment not found.');
      if (!currentUser) return alert('Please login.');
      if (currentUser.username !== com.userId && currentUser.type !== 'admin') return alert('You cannot delete this comment.');
      showConfirmModal('Delete comment', 'Delete this comment? This action cannot be undone.', () => {
        const ok = DB.deleteComment(cid);
        if (ok) { renderEventDetail(ev.id); } else alert('Could not delete comment.');
      });
    }));
    document.querySelectorAll('.gallery-image').forEach(g => g.addEventListener('click', function () { const i = this.querySelector('img'); if (i) window.open(i.src, '_blank'); }));
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": "&#39;" }[m]); }); }

  function isRegisteredFor(username, eventId) {
    if (!username) return false;
    const regs = DB.getRegistrations();
    return regs.some(r => r.userId === username && r.eventId === eventId);
  }
  function renderProfile() {
    if (!currentUser) return;
    const user = DB.getUsers().find(u => u.username === currentUser.username);
    if (!user) return;

    if (currentUser.type === 'student') {
      const regs = DB.getRegistrations(); const events = DB.getEvents();
      const userRegs = regs.filter(r => r.userId === currentUser.username);
      const registeredEvents = events.filter(e => userRegs.some(r => r.eventId === e.id));

      profileContent.innerHTML = `
              <h2 class="page-title">Student Profile</h2>
              <div class="profile-header">
                  <div class="profile-avatar" id="profileAvatar">
                      ${user.profilePicture ? `<img src="${user.profilePicture}" alt="${user.username}">` : `<div>${user.username[0] || 'S'}</div>`}
                      <div class="profile-avatar-edit" onclick="openProfileEdit()">Edit</div>
                  </div>
                  <div class="profile-info">
                      <h3>${user.username}</h3>
                      <p class="small-muted">${user.email}</p>
                      <p class="small-muted">Joined: ${new Date(user.createdAt).toLocaleDateString()}</p>
                      <button class="btn btn-secondary profile-edit-btn" onclick="openProfileEdit()">Edit Profile</button>
                  </div>
              </div>
              <div class="profile-about">
                  <h4>About Me</h4>
                  <p>${user.about || 'No information provided yet.'}</p>
              </div>
              <h3 style="margin-top:24px;">Registered Events (${registeredEvents.length})</h3>
              ${registeredEvents.length > 0 ? registeredEvents.map(e => `
                  <div class="event-card" data-id="${e.id}" style="margin-top:12px;">
                      <div class="event-image" style="background:#6366f1;width:140px;height:100px;flex-shrink:0;">
                          ${e.images && e.images.length > 0 ? `<img src="${e.images[0]}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fas fa-calendar-day fa-2x" style="color:#fff;"></i>`}
                          <div class="event-category">${e.category}</div>
                      </div>
                      <div class="event-content">
                          <h3 class="event-title">${e.title}</h3>
                          <div class="event-details">
                              <p class="small-muted"><i class="fas fa-university"></i> ${e.institution}</p>
                              <p class="small-muted">${e.date}</p>
                          </div>
                          <div style="display:flex;justify-content:space-between;align-items:center;">
                              <span>Click for details</span>
                              <div class="event-date">${formatDate(e.date)}</div>
                          </div>
                      </div>
                  </div>
              `).join('') : '<p class="small-muted">No events registered yet.</p>'}
          `;
      document.querySelectorAll('#profileContent .event-card').forEach(c => c.addEventListener('click', () => showEventPage(c.getAttribute('data-id'))));
    } else if (currentUser.type === 'institution') {
      const events = DB.getEvents().filter(e => e.institution === currentUser.username);

      profileContent.innerHTML = `
              <h2 class="page-title">Institution Profile</h2>
              <div class="profile-header">
                  <div class="profile-avatar" id="profileAvatar">
                      ${user.profilePicture ? `<img src="${user.profilePicture}" alt="${user.username}">` : `<div>${user.username[0] || 'I'}</div>`}
                      <div class="profile-avatar-edit" onclick="openProfileEdit()">Edit</div>
                  </div>
                  <div class="profile-info">
                      <h3>${user.username}</h3>
                      <p class="small-muted">${user.email}</p>
                      <p class="small-muted">Joined: ${new Date(user.createdAt).toLocaleDateString()}</p>
                      <button class="btn btn-secondary profile-edit-btn" onclick="openProfileEdit()">Edit Profile</button>
                  </div>
              </div>
              <div class="profile-about">
                  <h4>About Us</h4>
                  <p>${user.about || 'No information provided yet.'}</p>
              </div>
              <h3 style="margin-top:24px;">Hosted Events (${events.length})</h3>
              ${events.length > 0 ? events.map(e => `
                  <div class="event-card" data-id="${e.id}" style="margin-top:12px;">
                      <div class="event-image" style="background:#6366f1;width:140px;height:100px;flex-shrink:0;">
                          ${e.images && e.images.length > 0 ? `<img src="${e.images[0]}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fas fa-calendar-day fa-2x" style="color:#fff;"></i>`}
                          <div class="event-category">${e.category}</div>
                      </div>
                      <div class="event-content">
                          <h3 class="event-title">${e.title}</h3>
                          <div class="event-details">
                              <p class="small-muted">${e.date} | ${e.time}</p>
                          </div>
                          <div style="display:flex;justify-content:space-between;align-items:center;">
                              <span>Click for details</span>
                              <div class="event-date">${formatDate(e.date)}</div>
                          </div>
                      </div>
                  </div>
              `).join('') : '<p class="small-muted">No hosted events yet.</p>'}
          `;
      document.querySelectorAll('#profileContent .event-card').forEach(c => c.addEventListener('click', () => showEventPage(c.getAttribute('data-id'))));
    } else {
      showAdminProfilePage();
    }
  }
  function renderAdminProfile() {
    if (!currentUser || currentUser.type !== 'admin') return;
    const user = DB.getUsers().find(u => u.username === currentUser.username);
    if (!user) return;

    const users = DB.getUsers();
    const events = DB.getEvents();
    const comments = DB.getComments();

    document.getElementById('adminAvatar').textContent = (currentUser.username && currentUser.username[0]) || 'A';
    document.getElementById('adminName').textContent = currentUser.username;
    document.getElementById('adminEmail').textContent = currentUser.email;
    document.getElementById('adminJoined').textContent = 'Joined: ' + (user ? new Date(user.createdAt).toLocaleString() : '--');
    document.getElementById('totalUsers').textContent = users.length;
    document.getElementById('totalEvents').textContent = events.length;
    document.getElementById('totalComments').textContent = comments.length;
  }
  function renderUserProfile(userObj) {
    if (!userObj) return;

    if (userObj.type === 'student') {
      const regs = DB.getRegistrations();
      const events = DB.getEvents();
      const userRegs = regs.filter(r => r.userId === userObj.username);
      const registeredEvents = events.filter(e => userRegs.some(r => r.eventId === e.id));

      profileContent.innerHTML = `
              <h2 class="page-title">Student Profile — ${userObj.username}</h2>
              <div class="profile-header">
                  <div class="profile-avatar">
                      ${userObj.profilePicture ? `<img src="${userObj.profilePicture}" alt="${userObj.username}">` : `<div>${userObj.username[0] || 'S'}</div>`}
                  </div>
                  <div class="profile-info">
                      <h3>${userObj.username}</h3>
                      <p class="small-muted">${userObj.email}</p>
                      <p class="small-muted">Joined: ${new Date(userObj.createdAt).toLocaleDateString()}</p>
                  </div>
              </div>
              <div class="profile-about">
                  <h4>About Me</h4>
                  <p>${userObj.about || 'No information provided.'}</p>
              </div>
              <h3 style="margin-top:24px;">Registered Events (${registeredEvents.length})</h3>
              ${registeredEvents.length > 0 ? registeredEvents.map(e => `
                  <div class="event-card" data-id="${e.id}" style="margin-top:12px;">
                      <div class="event-image" style="background:#6366f1;width:140px;height:100px;flex-shrink:0;">
                          ${e.images && e.images.length > 0 ? `<img src="${e.images[0]}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fas fa-calendar-day fa-2x" style="color:#fff;"></i>`}
                          <div class="event-category">${e.category}</div>
                      </div>
                      <div class="event-content">
                          <h3 class="event-title">${e.title}</h3>
                          <div class="event-details">
                              <p class="small-muted"><i class="fas fa-university"></i> ${e.institution}</p>
                              <p class="small-muted">${e.date}</p>
                          </div>
                          <div style="display:flex;justify-content:space-between;align-items:center;">
                              <span>Click for details</span>
                              <div class="event-date">${formatDate(e.date)}</div>
                          </div>
                      </div>
                  </div>
              `).join('') : '<p class="small-muted">No events registered.</p>'}
          `;
      document.querySelectorAll('#profileContent .event-card').forEach(c => c.addEventListener('click', () => showEventPage(c.getAttribute('data-id'))));
    } else if (userObj.type === 'institution') {
      const events = DB.getEvents().filter(e => e.institution === userObj.username);

      profileContent.innerHTML = `
              <h2 class="page-title">Institution Profile — ${userObj.username}</h2>
              <div class="profile-header">
                  <div class="profile-avatar">
                      ${userObj.profilePicture ? `<img src="${userObj.profilePicture}" alt="${userObj.username}">` : `<div>${userObj.username[0] || 'I'}</div>`}
                  </div>
                  <div class="profile-info">
                      <h3>${userObj.username}</h3>
                      <p class="small-muted">${userObj.email}</p>
                      <p class="small-muted">Joined: ${new Date(userObj.createdAt).toLocaleDateString()}</p>
                  </div>
              </div>
              <div class="profile-about">
                  <h4>About Us</h4>
                  <p>${userObj.about || 'No information provided.'}</p>
              </div>
              <h3 style="margin-top:24px;">Hosted Events (${events.length})</h3>
              ${events.length > 0 ? events.map(e => `
                  <div class="event-card" data-id="${e.id}" style="margin-top:12px;">
                      <div class="event-image" style="background:#6366f1;width:140px;height:100px;flex-shrink:0;">
                          ${e.images && e.images.length > 0 ? `<img src="${e.images[0]}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fas fa-calendar-day fa-2x" style="color:#fff;"></i>`}
                          <div class="event-category">${e.category}</div>
                      </div>
                      <div class="event-content">
                          <h3 class="event-title">${e.title}</h3>
                          <div class="event-details">
                              <p class="small-muted">${e.date} | ${e.time}</p>
                          </div>
                          <div style="display:flex;justify-content:space-between;align-items:center;">
                              <span>Click for details</span>
                              <div class="event-date">${formatDate(e.date)}</div>
                          </div>
                      </div>
                  </div>
              `).join('') : '<p class="small-muted">No hosted events.</p>'}
          `;
      document.querySelectorAll('#profileContent .event-card').forEach(c => c.addEventListener('click', () => showEventPage(c.getAttribute('data-id'))));
    } else {
      profileContent.innerHTML = `
              <h2 class="page-title">Admin Profile — ${userObj.username}</h2>
              <div class="profile-header">
                  <div class="profile-avatar">
                      ${userObj.profilePicture ? `<img src="${userObj.profilePicture}" alt="${userObj.username}">` : `<div>${userObj.username[0] || 'A'}</div>`}
                  </div>
                  <div class="profile-info">
                      <h3>${userObj.username}</h3>
                      <p class="small-muted">${userObj.email}</p>
                      <p class="small-muted">Joined: ${new Date(userObj.createdAt).toLocaleDateString()}</p>
                  </div>
              </div>
          `;
    }
  }
  function openProfileEdit() {
    if (!currentUser) return;

    const user = DB.getUsers().find(u => u.username === currentUser.username);
    if (!user) return;
    profileAbout.value = user.about || '';
    if (user.profilePicture) {
      profileAvatarInitial.style.display = 'none';
      profileAvatarImg.style.display = 'block';
      profileAvatarImg.src = user.profilePicture;
    } else {
      profileAvatarInitial.style.display = 'block';
      profileAvatarImg.style.display = 'none';
      profileAvatarInitial.textContent = user.username[0] || 'U';
    }
    profileEditModal.classList.add('open');
    profileEditModal.setAttribute('aria-hidden', 'false');
  }
  changeProfileImageBtn.addEventListener('click', () => {
    profileImageInput.click();
  });

  profileImageInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    try {
      const dataUrl = await readFileAsDataURL(file);
      profileImageFile = file;
      profileAvatarInitial.style.display = 'none';
      profileAvatarImg.style.display = 'block';
      profileAvatarImg.src = dataUrl;
    } catch (err) {
      console.error('Error reading image:', err);
      alert('Error reading image file');
    }
  });
  profileEditForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!currentUser) return;

    try {
      let profilePicture = '';
      if (profileImageFile) {
        profilePicture = await readFileAsDataURL(profileImageFile);
      }

      const updates = {
        about: profileAbout.value,
        ...(profilePicture && { profilePicture })
      };

      const success = DB.updateUser(currentUser.username, updates);
      if (success) {
        alert('Profile updated successfully!');
        hideProfileEditModal();
        renderProfile();
      } else {
        alert('Error updating profile');
      }
    } catch (err) {
      console.error('Error updating profile:', err);
      alert('Error updating profile');
    }
  });

  profileEditCancel.addEventListener('click', hideProfileEditModal);
  profileEditModal.addEventListener('click', (e) => {
    if (e.target === profileEditModal) hideProfileEditModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && profileEditModal.classList.contains('open')) hideProfileEditModal();
  });

  function hideProfileEditModal() {
    profileEditModal.classList.remove('open');
    profileEditModal.setAttribute('aria-hidden', 'true');
    profileImageFile = null;
    profileImageInput.value = '';
  }
  function renderAdminUsers() {
    adminUsersList.innerHTML = '';
    const users = DB.getUsers();
    if (!users || users.length === 0) { adminUsersList.innerHTML = '<div class="small-muted">No accounts found.</div>'; return; }
    users.forEach(u => {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<div style="display:flex;gap:12px;align-items:center;"><div style="width:48px;height:48px;border-radius:8px;background:var(--primary);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">${u.username[0] || '?'}</div><div><div style="font-weight:700;">${u.username} <span style="font-weight:600;color:var(--muted);font-size:.86rem">(${u.type})</span></div><div class="small-muted">${u.email}</div></div></div><div style="display:flex;gap:8px;align-items:center;"><button class="btn btn-secondary view-user-btn" data-username="${u.username}"><i class="fas fa-eye"></i> View</button><button class="btn delete-event-btn delete-user-btn" data-username="${u.username}"><i class="fas fa-trash"></i> Delete</button></div>`;
      adminUsersList.appendChild(row);
    });
    adminUsersList.querySelectorAll('.view-user-btn').forEach(b => b.addEventListener('click', (e) => { const uname = e.currentTarget.getAttribute('data-username'); const user = DB.getUsers().find(x => x.username === uname); if (!user) return alert('User not found'); renderUserProfile(user); showProfilePage(); }));
    adminUsersList.querySelectorAll('.delete-user-btn').forEach(b => b.addEventListener('click', (e) => { const uname = e.currentTarget.getAttribute('data-username'); if (!uname) return; if (currentUser && currentUser.username === uname) { return alert('You cannot delete your own logged-in account.'); } showConfirmModal('Delete account', `Delete account "${uname}"? This will remove their registrations and hosted events (if any). This cannot be undone.`, () => { const deleted = DB.deleteUser(uname); if (deleted) { alert('User deleted.'); renderAdminUsers(); renderAdminEvents(); renderEvents(); } else alert('Could not find user.'); }); }));
  }

  function renderAdminEvents() {
    adminEventsList.innerHTML = '';
    const events = DB.getEvents();
    if (!events || events.length === 0) { adminEventsList.innerHTML = '<div class="small-muted">No events found.</div>'; return; }
    events.forEach(ev => {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<div style="display:flex;gap:12px;align-items:center;"><div style="width:80px;height:56px;border-radius:8px;overflow:hidden;background:#ddd;display:flex;align-items:center;justify-content:center;">${ev.images && ev.images.length ? `<img src="${ev.images[0]}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fas fa-calendar-day" style="font-size:22px;color:#666;"></i>`}</div><div style="flex:1;"><div style="font-weight:700;">${ev.title}</div><div class="small-muted">${ev.institution} • ${formatDate(ev.date)} • ${ev.category}</div></div></div><div style="display:flex;gap:8px;align-items:center;"><button class="btn btn-secondary view-event-admin-btn" data-id="${ev.id}"><i class="fas fa-eye"></i> View</button><button class="btn delete-event-btn delete-event-admin-btn" data-id="${ev.id}"><i class="fas fa-trash"></i> Delete</button></div>`;
      adminEventsList.appendChild(row);
    });
    adminEventsList.querySelectorAll('.view-event-admin-btn').forEach(b => b.addEventListener('click', (e) => { const id = e.currentTarget.getAttribute('data-id'); if (id) showEventPage(id); }));
    adminEventsList.querySelectorAll('.delete-event-admin-btn').forEach(b => b.addEventListener('click', (e) => { const id = e.currentTarget.getAttribute('data-id'); const ev = DB.getEvents().find(x => x.id === id); showConfirmModal('Delete event', `Delete "${(ev && ev.title) || 'this event'}"? This cannot be undone.`, () => { const ok = DB.deleteEvent(id); if (ok) { alert('Event deleted.'); renderAdminEvents(); renderEvents(); } else alert('Could not delete event.'); }); }));
  }
  function showConfirmModal(title, body, onConfirm) {
    modalTitle.textContent = title || 'Confirm';
    modalBody.textContent = body || '';
    modalConfirmCallback = () => { try { if (typeof onConfirm === 'function') onConfirm(); } finally { hideModal(); } };
    modalOverlay.classList.add('open'); modalOverlay.setAttribute('aria-hidden', 'false');
    modalConfirmBtn.focus();
  }
  function hideModal() { modalOverlay.classList.remove('open'); modalOverlay.setAttribute('aria-hidden', 'true'); modalConfirmCallback = null; }
  modalConfirmBtn.addEventListener('click', () => { if (typeof modalConfirmCallback === 'function') modalConfirmCallback(); else hideModal(); });
  modalCancelBtn.addEventListener('click', hideModal);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) hideModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalOverlay.classList.contains('open')) hideModal(); });
  function formatDate(dateStr) { if (!dateStr) return ''; try { const d = new Date(dateStr); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch (e) { return dateStr; } }
  function tryRestoreSession() {
    const s = loadSession();
    if (!s) { showAuthPage(); return; }
    if (s.expiresAt && Date.now() < s.expiresAt) {
      const user = DB.getUsers().find(u => u.username === s.username);
      if (user) {
        currentUser = { type: s.role, username: s.username, email: user.email };
        if (s.role === 'institution') document.querySelectorAll('.institution-only').forEach(el => el.classList.remove('hidden'));
        if (s.role === 'admin') document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
        if (s.role === 'admin') document.querySelectorAll('.institution-only').forEach(el => el.classList.add('hidden'));
        showMainPage();
        return;
      }
    }
    clearSession(); showAuthPage();
  }
  tryRestoreSession();
  function renderDmPage() {
    if (!currentUser) return;
    dmContacts = DB.getConversations(currentUser.username);
    dmContactList.innerHTML = '';
    if (dmContacts.length === 0) {
      dmContactList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">No conversations yet</div>';
    } else {
      dmContacts.forEach(contact => {
        const user = DB.getUsers().find(u => u.username === contact.userId);
        if (!user) return;

        const li = document.createElement('li');
        li.className = 'dm-contact';
        li.setAttribute('data-userid', user.username);
        li.innerHTML = `
                  <div class="dm-contact-avatar">
                      ${user.profilePicture ? `<img src="${user.profilePicture}" alt="${user.username}">` : user.username[0] || 'U'}
                  </div>
                  <div class="dm-contact-info">
                      <div class="dm-contact-name">${user.username}</div>
                      <div class="dm-contact-preview">${contact.lastMessage || 'Start a conversation'}</div>
                  </div>
              `;
        dmContactList.appendChild(li);
      });
    }
    document.querySelectorAll('.dm-contact').forEach(contact => {
      contact.addEventListener('click', () => {
        const userId = contact.getAttribute('data-userid');
        selectDmContact(userId);
      });
    });
    dmContactSearch.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase();
      document.querySelectorAll('.dm-contact').forEach(contact => {
        const name = contact.querySelector('.dm-contact-name').textContent.toLowerCase();
        contact.style.display = name.includes(searchTerm) ? 'flex' : 'none';
      });
    });
    dmCurrentName.textContent = 'Select a conversation';
    dmMessageInput.disabled = true;
    dmSendButton.disabled = true;
    dmMessagesContent.innerHTML = '';
  }

  function selectDmContact(userId) {
    if (!currentUser) return;

    currentDmContact = userId;
    const user = DB.getUsers().find(u => u.username === userId);
    if (!user) return;
    document.querySelectorAll('.dm-contact').forEach(c => {
      c.classList.remove('active');
      if (c.getAttribute('data-userid') === userId) {
        c.classList.add('active');
      }
    });

    dmCurrentAvatar.innerHTML = user.profilePicture ?
      `<img src="${user.profilePicture}" alt="${user.username}">` :
      user.username[0] || 'U';
    dmCurrentName.textContent = user.username;
    dmMessageInput.disabled = false;
    dmSendButton.disabled = false;
    loadDmMessages(userId);
  }

  function loadDmMessages(userId) {
    if (!currentUser) return;

    const messages = DB.getMessages(currentUser.username, userId);
    dmMessagesContent.innerHTML = '';

    if (messages.length === 0) {
      dmMessagesContent.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">No messages yet. Start a conversation!</div>';
      return;
    }

    messages.forEach(msg => {
      const isSent = msg.senderId === currentUser.username;
      const messageDiv = document.createElement('div');
      messageDiv.className = `dm-message ${isSent ? 'sent' : 'received'}`;
      messageDiv.innerHTML = `
              <div>${msg.content}</div>
              <div class="dm-message-time">${formatTime(msg.timestamp)}</div>
          `;
      dmMessagesContent.appendChild(messageDiv);
    });
    dmMessagesContent.scrollTop = dmMessagesContent.scrollHeight;
  }
  dmSendButton.addEventListener('click', sendDmMessage);
  dmMessageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendDmMessage();
  });

  function sendDmMessage() {
    if (!currentUser || !currentDmContact) return;

    const message = dmMessageInput.value.trim();
    if (!message) return;
    DB.addDM({
      senderId: currentUser.username,
      receiverId: currentDmContact,
      content: message
    });
    dmMessageInput.value = '';
    loadDmMessages(currentDmContact);
    renderDmPage();
  }
  function renderSearchPage() {
    userSearchResults.innerHTML = '';
    userSearchInput.value = '';
    userSearchInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase().trim();
      if (searchTerm.length < 2) {
        userSearchResults.innerHTML = '';
        return;
      }

      const users = DB.getUsers().filter(user =>
        user.username.toLowerCase().includes(searchTerm) ||
        (user.email && user.email.toLowerCase().includes(searchTerm)) ||
        (user.about && user.about.toLowerCase().includes(searchTerm))
      );

      displaySearchResults(users);
    });
  }

  function displaySearchResults(users) {
    userSearchResults.innerHTML = '';

    if (users.length === 0) {
      userSearchResults.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">No users found</div>';
      return;
    }

    users.forEach(user => {
      if (user.username === currentUser.username) return;

      const resultDiv = document.createElement('div');
      resultDiv.className = 'search-result';
      resultDiv.setAttribute('data-userid', user.username);
      resultDiv.innerHTML = `
              <div class="search-result-avatar">
                  ${user.profilePicture ? `<img src="${user.profilePicture}" alt="${user.username}">` : user.username[0] || 'U'}
              </div>
              <div class="search-result-info">
                  <div class="search-result-name">${user.username}</div>
                  <div class="search-result-email">${user.email || 'No email'}</div>
                  <div class="search-result-type">${user.type}</div>
              </div>
          `;
      userSearchResults.appendChild(resultDiv);
    });
    document.querySelectorAll('.search-result').forEach(result => {
      result.addEventListener('click', () => {
        const userId = result.getAttribute('data-userid');
        const user = DB.getUsers().find(u => u.username === userId);
        if (user) {
          alert(`Viewing profile of ${user.username}`);
        }
      });
    });
  }
  changeProfileImageBtn.addEventListener('click', () => {
    profileImageInput.click();
  });

  profileImageInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    try {
      const dataUrl = await readFileAsDataURL(file);
      profileImageFile = file;
      profileAvatarInitial.style.display = 'none';
      profileAvatarImg.style.display = 'block';
      profileAvatarImg.src = dataUrl;
    } catch (err) {
      console.error('Error reading image:', err);
      alert('Error reading image file');
    }
  });
  profileEditForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!currentUser) return;

    try {
      let profilePicture = '';
      if (profileImageFile) {
        profilePicture = await readFileAsDataURL(profileImageFile);
      }

      const updates = {
        about: profileAbout.value,
        ...(profilePicture && { profilePicture })
      };

      const success = DB.updateUser(currentUser.username, updates);
      if (success) {
        alert('Profile updated successfully!');
        hideProfileEditModal();
        renderProfile();
      } else {
        alert('Error updating profile');
      }
    } catch (err) {
      console.error('Error updating profile:', err);
      alert('Error updating profile');
    }
  });
  function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  document.addEventListener('DOMContentLoaded', function () {
    if (currentUser) {
      dmContactSearch.addEventListener('input', filterDmContacts);
      dmSendButton.addEventListener('click', sendDmMessage);
      dmMessageInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') sendDmMessage();
      });
      userSearchInput.addEventListener('input', performSearch);
    }
  });
  function filterDmContacts(e) {
    const searchTerm = e.target.value.toLowerCase();
    document.querySelectorAll('.dm-contact').forEach(contact => {
      const name = contact.querySelector('.dm-contact-name').textContent.toLowerCase();
      contact.style.display = name.includes(searchTerm) ? 'flex' : 'none';
    });
  }

  function performSearch(e) {
    const searchTerm = e.target.value.toLowerCase().trim();
    if (searchTerm.length < 2) {
      userSearchResults.innerHTML = '';
      return;
    }

    const users = DB.getUsers().filter(user =>
      user.username.toLowerCase().includes(searchTerm) ||
      (user.email && user.email.toLowerCase().includes(searchTerm)) ||
      (user.about && user.about.toLowerCase().includes(searchTerm))
    );

    displaySearchResults(users);
  }
  (function () {
    function attachSwitch(anchorId, targetFormId) {
      const a = document.getElementById(anchorId);
      if (!a) return;
      a.setAttribute('role', 'button');
      a.setAttribute('tabindex', '0');
      a.addEventListener('click', switchHandler);
      a.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          switchHandler.call(a, e);
        }
      });
      function switchHandler(ev) {
        ev.preventDefault();
        if (typeof showOnlyForm === 'function') {
          showOnlyForm(targetFormId);
        } else if (typeof showAuthForm === 'function') {
          const map = { studentRegisterForm: 'student', studentLoginForm: 'student', institutionRegisterForm: 'institution', institutionLoginForm: 'institution', adminRegisterForm: 'admin', adminLoginForm: 'admin' };
          const tab = map[targetFormId] || 'student';
          showAuthForm(tab);
          const el = document.getElementById(targetFormId);
          if (el) {
            document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
            el.classList.add('active');
          }
        }
      }
    }

    attachSwitch('switchToStudentRegister', 'studentRegisterForm');
    attachSwitch('switchToStudentLogin', 'studentLoginForm');
    attachSwitch('switchToInstitutionRegister', 'institutionRegisterForm');
    attachSwitch('switchToInstitutionLogin', 'institutionLoginForm');
    attachSwitch('switchToAdminRegister', 'adminRegisterForm');
    attachSwitch('switchToAdminLogin', 'adminLoginForm');
  })();
  window.openProfileEdit = openProfileEdit;