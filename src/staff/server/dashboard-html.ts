/**
 * Render Markdown safely to HTML with full XSS escaping.
 * Supports bold, italics, links, lists, images, and newlines.
 */
export function renderSafeMarkdown(content: string): string {
  if (!content) return '';

  // 1. HTML Escape special characters to prevent XSS
  let escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // 2. Bold: **text** -> <strong>text</strong>
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // 3. Italic: *text* -> <em>text</em>
  escaped = escaped.replace(/(^|[^*])\*([^*]+?)\*(?!\*)/g, '$1<em>$2</em>');

  // 4. Markdown links: [text](url) -> <a href="url" target="_blank" rel="noopener noreferrer">text</a>
  // Strict security: only allow https:// and http:// schemes to block javascript: / data: / vbscript: vectors
  escaped = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s'")]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--gold); text-decoration:underline;">$1</a>'
  );

  // 5. Bullet list items: - text -> • text
  escaped = escaped.replace(/(?:^|\n)-\s+([^\n]+)/g, '\n• $1');

  // 6. Linebreaks: \n -> <br>
  escaped = escaped.replace(/\n/g, '<br>');

  return escaped;
}

export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>J Collection Concierge — Staff Dashboard & Human Takeover</title>
  <style>
    :root {
      --bg-dark: #121417;
      --bg-panel: #1a1e24;
      --bg-card: #222730;
      --bg-hover: #2d3340;
      --text-main: #f0f2f5;
      --text-muted: #9aa0a6;
      --gold: #d4af37;
      --gold-light: #f3e5ab;
      --accent: #2979ff;
      --danger: #f44336;
      --warning: #ff9800;
      --success: #4caf50;
      --border: #2e3542;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background-color: var(--bg-dark); color: var(--text-main); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

    /* Login Screen */
    #login-overlay {
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: radial-gradient(circle at center, #1e2430 0%, #0d0f12 100%);
      display: flex; align-items: center; justify-content: center; z-index: 1000;
    }
    .login-box {
      background: var(--bg-panel); border: 1px solid var(--border); border-radius: 12px;
      padding: 36px; width: 440px; box-shadow: 0 16px 40px rgba(0,0,0,0.6);
    }
    .login-title { font-size: 22px; font-weight: 700; color: var(--gold); text-align: center; margin-bottom: 6px; letter-spacing: 0.5px; }
    .login-sub { font-size: 13px; color: var(--text-muted); text-align: center; margin-bottom: 24px; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 6px; }
    .form-group input, select, textarea {
      width: 100%; padding: 10px 14px; background: var(--bg-dark); border: 1px solid var(--border);
      border-radius: 6px; color: var(--text-main); font-size: 14px; outline: none;
    }
    .form-group input:focus, select:focus, textarea:focus { border-color: var(--gold); }
    .btn {
      padding: 10px 16px; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;
      font-size: 14px; transition: all 0.2s ease; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    }
    .btn-gold { background: var(--gold); color: #000; }
    .btn-gold:hover { background: #e5bd3b; }
    .btn-takeover { background: var(--warning); color: #000; }
    .btn-takeover:hover { background: #ffa726; }
    .btn-resume { background: var(--accent); color: #fff; }
    .btn-resume:hover { background: #448aff; }
    .btn-close-conv { background: #374151; color: #fff; }
    .btn-close-conv:hover { background: #4b5563; }
    .btn-secondary { background: var(--bg-hover); color: var(--text-main); border: 1px solid var(--border); }
    .btn-secondary:hover { background: #3a4252; }
    .btn-danger { background: var(--danger); color: #fff; }
    .quick-logins { margin-top: 20px; border-top: 1px solid var(--border); padding-top: 16px; }
    .quick-title { font-size: 12px; color: var(--text-muted); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    .quick-btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .quick-btn { padding: 8px 10px; font-size: 12px; text-align: left; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
    .quick-btn:hover { border-color: var(--gold); background: var(--bg-hover); }

    /* App Header */
    header {
      background: var(--bg-panel); border-bottom: 1px solid var(--border); height: 56px;
      display: flex; align-items: center; justify-content: space-between; padding: 0 20px; flex-shrink: 0;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-title { font-size: 16px; font-weight: 700; color: var(--gold); }
    .brand-sub { font-size: 12px; color: var(--text-muted); background: var(--bg-card); padding: 3px 8px; border-radius: 4px; border: 1px solid var(--border); }
    .header-actions { display: flex; align-items: center; gap: 14px; }
    .user-pill { display: flex; align-items: center; gap: 8px; background: var(--bg-card); padding: 6px 12px; border-radius: 20px; font-size: 13px; border: 1px solid var(--border); }

    /* App Layout */
    .dashboard-layout { display: flex; flex: 1; overflow: hidden; }

    /* Left Sidebar: Conversations Inbox */
    .inbox-pane { width: 340px; background: var(--bg-panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
    .inbox-filters { padding: 12px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; }
    .filter-tabs { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 4px; }
    .filter-tab { font-size: 12px; padding: 6px 10px; border-radius: 4px; background: transparent; border: 1px solid transparent; color: var(--text-muted); cursor: pointer; white-space: nowrap; }
    .filter-tab.active { background: var(--bg-card); border-color: var(--gold); color: var(--gold); font-weight: 600; }
    .inbox-list { flex: 1; overflow-y: auto; }
    .conv-item { padding: 12px 14px; border-bottom: 1px solid var(--border); cursor: pointer; transition: background 0.15s; }
    .conv-item:hover { background: var(--bg-hover); }
    .conv-item.active { background: var(--bg-card); border-left: 3px solid var(--gold); }
    .conv-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .conv-name { font-size: 14px; font-weight: 600; color: var(--text-main); }
    .conv-time { font-size: 11px; color: var(--text-muted); }
    .conv-snippet { font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 6px; }
    .conv-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

    /* Status Badges */
    .badge { font-size: 11px; padding: 2px 7px; border-radius: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
    .badge-AI_ACTIVE { background: rgba(76, 175, 80, 0.15); color: #81c784; border: 1px solid rgba(76, 175, 80, 0.3); }
    .badge-WAITING_FOR_STAFF { background: rgba(244, 67, 54, 0.2); color: #ff8a80; border: 1px solid rgba(244, 67, 54, 0.4); animation: pulse 1.8s infinite; }
    .badge-HUMAN_ACTIVE { background: rgba(255, 152, 0, 0.2); color: #ffb74d; border: 1px solid rgba(255, 152, 0, 0.4); }
    .badge-AI_RESUME_PENDING { background: rgba(41, 121, 255, 0.15); color: #82b1ff; border: 1px solid rgba(41, 121, 255, 0.3); }
    .badge-CLOSED { background: #262c36; color: #78909c; border: 1px solid #37474f; }
    .badge-property { background: #2d323d; color: var(--gold-light); font-size: 10px; }
    .badge-unread { background: var(--danger); color: #fff; font-size: 10px; padding: 2px 6px; border-radius: 10px; }

    @keyframes pulse { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }

    /* Middle Pane: Chat Timeline */
    .chat-pane { flex: 1; display: flex; flex-direction: column; background: var(--bg-dark); }
    .chat-header {
      background: var(--bg-panel); border-bottom: 1px solid var(--border); padding: 12px 20px;
      display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
    }
    .chat-header-info { display: flex; align-items: center; gap: 12px; }
    .chat-customer-name { font-size: 15px; font-weight: 700; color: var(--text-main); }
    .chat-controls { display: flex; align-items: center; gap: 8px; }
    .chat-messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
    
    .msg-wrapper { display: flex; flex-direction: column; max-width: 72%; }
    .msg-customer { align-self: flex-start; }
    .msg-ai { align-self: flex-end; }
    .msg-staff { align-self: flex-end; }
    .msg-system { align-self: center; max-width: 90%; }

    .msg-bubble { padding: 10px 14px; border-radius: 12px; font-size: 13.5px; line-height: 1.45; word-wrap: break-word; }
    .msg-customer .msg-bubble { background: var(--bg-card); border: 1px solid var(--border); color: var(--text-main); border-bottom-left-radius: 2px; }
    .msg-ai .msg-bubble { background: #1a251e; border: 1px solid #2e4a36; color: #e8f5e9; border-bottom-right-radius: 2px; }
    .msg-staff .msg-bubble { background: #2a2510; border: 1px solid #63501a; color: #fff8e1; border-bottom-right-radius: 2px; }
    .msg-system .msg-bubble { background: var(--bg-panel); border: 1px dashed var(--border); color: var(--text-muted); font-size: 12px; text-align: center; }

    .msg-meta { font-size: 10.5px; color: var(--text-muted); margin-top: 3px; display: flex; gap: 6px; }
    .msg-ai .msg-meta, .msg-staff .msg-meta { justify-content: flex-end; }
    .telemetry-tag { background: #162a1e; color: #81c784; padding: 1px 5px; border-radius: 3px; border: 1px solid #2e4a36; font-size: 10px; }

    .chat-input-bar {
      background: var(--bg-panel); border-top: 1px solid var(--border); padding: 12px 20px;
      display: flex; gap: 10px; align-items: center; flex-shrink: 0;
    }
    .chat-input-bar input { flex: 1; }
    .takeover-banner { background: #2b2110; border: 1px solid #6a521a; color: #ffe082; padding: 8px 16px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }

    /* Right Pane: Utilities & Tabs */
    .tools-pane { width: 340px; background: var(--bg-panel); border-left: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
    .tools-header { display: flex; border-bottom: 1px solid var(--border); }
    .tool-tab { flex: 1; padding: 12px 8px; font-size: 12px; font-weight: 600; text-align: center; color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent; }
    .tool-tab.active { color: var(--gold); border-bottom-color: var(--gold); }
    .tool-content { flex: 1; overflow-y: auto; padding: 16px; display: none; }
    .tool-content.active { display: block; }

    /* Notes */
    .note-item { background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 10px; margin-bottom: 10px; }
    .note-header { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
    .note-author { font-weight: 600; color: var(--gold-light); }
    .note-text { font-size: 12.5px; line-height: 1.4; color: var(--text-main); }

    /* Modal */
    .modal-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.7); display: none; align-items: center; justify-content: center; z-index: 999; }
    .modal-box { background: var(--bg-panel); border: 1px solid var(--border); border-radius: 10px; width: 540px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .modal-title { font-size: 17px; font-weight: 700; color: var(--gold); }
    .close-btn { cursor: pointer; font-size: 20px; color: var(--text-muted); }

    /* Image Gallery & Lightbox */
    .room-albums-stack { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
    .room-album-block { background: rgba(18, 22, 28, 0.72); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
    .room-album-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; padding-bottom: 5px; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 12px; }
    .room-album-title { font-weight: 700; color: var(--gold-light); }
    .room-album-meta { font-size: 11px; color: var(--text-muted); }
    .msg-images-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin-top: 6px; }
    .gallery-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; cursor: pointer; transition: transform 0.15s, border-color 0.15s; }
    .gallery-card:hover { transform: translateY(-2px); border-color: var(--gold); }
    .room-thumbnail { width: 100%; height: 85px; object-fit: cover; display: block; }
    .gallery-card-caption { font-size: 11px; padding: 4px 6px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    #lightbox-modal { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.88); display: none; align-items: center; justify-content: center; z-index: 1001; }
    .lightbox-content { position: relative; max-width: 90vw; max-height: 90vh; display: flex; flex-direction: column; align-items: center; }
    .lightbox-img { max-width: 82vw; max-height: 76vh; min-width: 280px; min-height: 200px; background: #222730; object-fit: contain; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.9); }
    .lightbox-header { color: var(--gold-light); font-size: 14px; font-weight: 700; margin-bottom: 8px; text-align: center; }
    .lightbox-caption { color: var(--text-main); font-size: 13px; margin-top: 8px; font-weight: 500; text-align: center; }
    .lightbox-nav { display: flex; align-items: center; gap: 16px; margin-top: 10px; }
    .lightbox-nav-btn { background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.22); border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 13px; font-weight: 600; }
    .lightbox-nav-btn:hover:not(:disabled) { background: rgba(212,175,55,0.3); border-color: var(--gold); }
    .lightbox-nav-btn:disabled { opacity: 0.35; cursor: default; }
    .lightbox-close { position: absolute; top: -36px; right: 0; font-size: 32px; color: #fff; cursor: pointer; line-height: 1; }
  </style>
</head>
<body>

  <!-- Lightbox Modal -->
  <div id="lightbox-modal" onclick="closeLightbox()">
    <div class="lightbox-content" onclick="event.stopPropagation()">
      <span class="lightbox-close" onclick="closeLightbox()">&times;</span>
      <div id="lightbox-room-title" class="lightbox-header"></div>
      <img id="lightbox-img" class="lightbox-img" src="" alt="Room detail" />
      <div id="lightbox-caption" class="lightbox-caption"></div>
      <div class="lightbox-nav">
        <button id="lightbox-prev" class="lightbox-nav-btn" type="button" onclick="navigateLightbox(-1)">‹ Trước</button>
        <span id="lightbox-counter" style="font-size:12px; color:var(--text-muted);"></span>
        <button id="lightbox-next" class="lightbox-nav-btn" type="button" onclick="navigateLightbox(1)">Sau ›</button>
      </div>
    </div>
  </div>

  <!-- Login Modal -->
  <div id="login-overlay">
    <div class="login-box">
      <div class="login-title">J COLLECTION CONCIERGE</div>
      <div class="login-sub">Đăng nhập bảng điều khiển Lễ tân & Quản trị</div>
      
      <div id="login-error" style="display:none; color: var(--danger); font-size: 13px; margin-bottom: 12px; text-align: center;"></div>

      <div class="form-group">
        <label>Tên đăng nhập</label>
        <input type="text" id="login-username" placeholder="admin hoặc staff_village...">
      </div>
      <div class="form-group">
        <label>Mật khẩu</label>
        <input type="password" id="login-password" placeholder="Nhập mật khẩu...">
      </div>
      <button class="btn btn-gold" style="width:100%; margin-top: 8px;" onclick="doLogin()">ĐĂNG NHẬP</button>

      <div class="quick-logins">
        <div class="quick-title">Đăng nhập nhanh thử nghiệm (Quick Preset):</div>
        <div class="quick-btn-grid">
          <button class="quick-btn" onclick="presetLogin('admin', 'Admin@JCollection2026!')">
            <strong>👑 Tổng Quản Trị (Admin)</strong><br><span style="color:#aaa;">Toàn quyền 3 cơ sở</span>
          </button>
          <button class="quick-btn" onclick="presetLogin('staff_village', 'Staff@Village2026!')">
            <strong>🏨 Lễ tân J Village</strong><br><span style="color:#aaa;">Chỉ cơ sở J Village</span>
          </button>
          <button class="quick-btn" onclick="presetLogin('staff_tkc', 'Staff@TKC2026!')">
            <strong>🏨 Lễ tân TKC</strong><br><span style="color:#aaa;">Chỉ cơ sở Trần Khát Chân</span>
          </button>
          <button class="quick-btn" onclick="presetLogin('staff_hadong', 'Staff@HaDong2026!')">
            <strong>🏨 Lễ tân Hà Đông</strong><br><span style="color:#aaa;">Chỉ cơ sở Jacayl Hà Đông</span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Main Header -->
  <header>
    <div class="brand">
      <span class="brand-title">J COLLECTION CONCIERGE</span>
      <span class="brand-sub">V3.0 FINAL — LLM-Native Staff Concierge & Takeover</span>
      <span class="badge" style="background:#162a1e; color:#81c784; border:1px solid #2e4a36; font-size:11px; padding:3px 8px; border-radius:4px; font-weight:600; margin-left:8px;">V3.0 FINAL</span>
    </div>
    <div class="header-actions">
      <div class="user-pill">
        <span id="user-display-name">Chưa đăng nhập</span>
        <span id="user-display-property" class="badge badge-property">Toàn quyền</span>
      </div>
      <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 10px;" onclick="openTelemetryModal()">
        📡 LLM Telemetry
      </button>
      <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 10px;" onclick="doLogout()">
        Đăng xuất
      </button>
    </div>
  </header>

  <!-- App Layout -->
  <div class="dashboard-layout">
    <!-- Left Pane: Conversations Inbox -->
    <div class="inbox-pane">
      <div class="inbox-filters">
        <div style="display: flex; gap: 8px;">
          <select id="property-selector" onchange="loadConversations()" style="font-size: 12px; padding: 6px 8px;">
            <option value="">Tất cả cơ sở</option>
            <option value="j-village">J Village</option>
            <option value="jacayl-tran-khat-chan">Jacayl Trần Khát Chân</option>
            <option value="jacayl-ha-dong">Jacayl Hà Đông</option>
          </select>
          <input type="text" id="search-box" placeholder="Tìm kiếm tên, SĐT..." oninput="debounceSearch()" style="font-size: 12px; padding: 6px 10px;">
        </div>
        <div class="filter-tabs">
          <button class="filter-tab active" onclick="setFilterState('ALL', this)">Tất cả</button>
          <button class="filter-tab" onclick="setFilterState('WAITING_FOR_STAFF', this)">Cần xử lý ⚠️</button>
          <button class="filter-tab" onclick="setFilterState('HUMAN_ACTIVE', this)">Đang tiếp quản ⚡</button>
          <button class="filter-tab" onclick="setFilterState('AI_ACTIVE', this)">AI Trực tuyến 🤖</button>
          <button class="filter-tab" onclick="setFilterState('CLOSED', this)">Đã đóng</button>
        </div>
      </div>
      <div class="inbox-list" id="conversation-list">
        <!-- Rendered items -->
      </div>
    </div>

    <!-- Middle Pane: Chat Timeline -->
    <div class="chat-pane">
      <div class="chat-header" id="chat-header" style="display:none;">
        <div class="chat-header-info">
          <div>
            <div class="chat-customer-name" id="current-customer-name">Khách hàng</div>
            <div style="font-size: 12px; color: var(--text-muted); display:flex; gap: 8px; align-items:center; margin-top:2px;">
              <span id="current-property-name" class="badge badge-property">Cơ sở</span>
              <span id="current-conv-state" class="badge">AI_ACTIVE</span>
              <span id="current-assigned-staff" style="color: var(--gold-light);"></span>
            </div>
          </div>
        </div>
        <div class="chat-controls">
          <button id="btn-takeover" class="btn btn-takeover" onclick="handleTakeover()">
            ⚡ Tiếp quản (Takeover)
          </button>
          <button id="btn-resume" class="btn btn-resume" style="display:none;" onclick="handleResumeAI()">
            🤖 Trả lại AI (Resume)
          </button>
          <button id="btn-close" class="btn btn-close-conv" onclick="handleCloseConversation()">
            ✓ Đóng hội thoại
          </button>
        </div>
      </div>

      <!-- Takeover status banner -->
      <div id="takeover-banner" class="takeover-banner" style="display:none;">
        <span>⚠️ <strong>Cuộc trò chuyện đang ở chế độ TIẾP QUẢN THỦ CÔNG.</strong> Trợ lý AI đã bị tạm dừng hoàn toàn.</span>
        <button class="btn btn-resume" style="padding: 4px 10px; font-size: 12px;" onclick="handleResumeAI()">Trả lại cho AI</button>
      </div>

      <div class="chat-messages" id="chat-messages">
        <div style="text-align: center; color: var(--text-muted); margin-top: 40px;">
          Chọn một cuộc trò chuyện từ danh sách bên trái để xem nội dung
        </div>
      </div>

      <!-- Staff message input bar -->
      <div class="chat-input-bar" id="chat-input-bar" style="display:none;">
        <input type="text" id="staff-message-input" placeholder="Nhập tin nhắn lễ tân gửi tới khách..." onkeydown="if(event.key==='Enter') sendStaffMessage()">
        <button class="btn btn-gold" id="btn-send-staff" onclick="sendStaffMessage()">Gửi (Lễ tân)</button>
      </div>
    </div>

    <!-- Right Pane: Utilities (Notes, Simulated Customer, Audit) -->
    <div class="tools-pane">
      <div class="tools-header">
        <div class="tool-tab active" onclick="switchToolTab('simulated', this)">Khách thử nghiệm</div>
        <div class="tool-tab" onclick="switchToolTab('notes', this)">Ghi chú nội bộ</div>
        <div class="tool-tab" onclick="switchToolTab('audit', this)">Nhật ký (Audit)</div>
      </div>

      <!-- Tool Tab 1: Simulated Customer Chat -->
      <div id="tab-simulated" class="tool-content active">
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
          Gửi tin nhắn giả lập từ khách hàng đến hội thoại đang chọn để kiểm tra phản ứng của AI hoặc Lễ tân.
        </div>
        <div class="form-group">
          <label>Cơ sở hỏi đáp</label>
          <select id="sim-property-select">
            <option value="jacayl-ha-dong">Jacayl Hà Đông</option>
            <option value="j-village">J Village</option>
            <option value="jacayl-tran-khat-chan">Jacayl Trần Khát Chân</option>
          </select>
        </div>
        <div class="form-group">
          <label>Nội dung câu hỏi mẫu nhanh</label>
          <div style="display:flex; flex-direction:column; gap: 6px; margin-bottom: 8px;">
            <button class="quick-btn" onclick="setSimQuestion('Xem chi tiết phòng 601 Hà Đông với em')">Phòng 601 Hà Đông (50 — Sắc Thái)</button>
            <button class="quick-btn" onclick="setSimQuestion('Phòng 401 ở Hà Đông giá bao nhiêu em?')">Phòng 401 Hà Đông (NOT_FOR_SALE)</button>
            <button class="quick-btn" onclick="setSimQuestion('Giá thuê 1 tiếng phòng 201 La Casta ở Hà Đông là bao nhiêu?')">Thuê 1 tiếng (Min 2h V1.4.3)</button>
            <button class="quick-btn" onclick="setSimQuestion('Khách sạn có chỗ đỗ xe không em?')">Bãi đỗ xe ("Dạ có")</button>
            <button class="quick-btn" onclick="setSimQuestion('Cho anh gặp trực tiếp nhân viên lễ tân với!')">Yêu cầu gặp người (Escalation)</button>
          </div>
          <textarea id="sim-input-text" rows="3" placeholder="Nhập câu hỏi của khách..."></textarea>
        </div>
        <button class="btn btn-gold" style="width:100%;" onclick="sendSimulatedCustomerMessage()">
          📤 Gửi với tư cách Khách Hàng
        </button>
      </div>

      <!-- Tool Tab 2: Internal Notes -->
      <div id="tab-notes" class="tool-content">
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
          Ghi chú bàn giao ca, số phòng, yêu cầu đặc biệt (chỉ nhân viên thấy).
        </div>
        <div class="form-group">
          <textarea id="new-note-text" rows="3" placeholder="Nhập ghi chú mới cho ca trực..."></textarea>
          <button class="btn btn-secondary" style="width:100%; margin-top:6px;" onclick="addInternalNote()">
            + Thêm ghi chú
          </button>
        </div>
        <div id="notes-container" style="margin-top: 16px;">
          <!-- Notes list -->
        </div>
      </div>

      <!-- Tool Tab 3: Audit Trail -->
      <div id="tab-audit" class="tool-content">
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
          Lịch sử các thao tác tiếp quản, đổi trạng thái và gửi tin nhắn.
        </div>
        <div id="audit-container">
          <!-- Audit logs -->
        </div>
      </div>
    </div>
  </div>

  <!-- Telemetry Modal -->
  <div id="telemetry-modal" class="modal-backdrop">
    <div class="modal-box">
      <div class="modal-header">
        <span class="modal-title">Trạng thái Free LLM API & Runtime Quota</span>
        <span class="close-btn" onclick="closeTelemetryModal()">&times;</span>
      </div>
      <div id="telemetry-content" style="font-size: 13px; line-height: 1.6;">
        Đang tải thông tin kết nối API...
      </div>
    </div>
  </div>

  <script>
    let authToken = localStorage.getItem('staff_token') || null;
    let currentUser = null;
    let activeConversationId = null;
    let currentFilterState = 'ALL';
    let searchTimeout = null;

    // Startup check
    window.onload = async () => {
      if (authToken) {
        try {
          await fetchCurrentUser();
        } catch (e) {
          showLogin();
        }
      } else {
        showLogin();
      }
    };

    function showLogin() {
      document.getElementById('login-overlay').style.display = 'flex';
    }

    function hideLogin() {
      document.getElementById('login-overlay').style.display = 'none';
    }

    async function presetLogin(u, p) {
      document.getElementById('login-username').value = u;
      document.getElementById('login-password').value = p;
      await doLogin();
    }

    async function doLogin() {
      const u = document.getElementById('login-username').value.trim();
      const p = document.getElementById('login-password').value;
      const errBox = document.getElementById('login-error');
      errBox.style.display = 'none';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: p })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Đăng nhập thất bại.');

        authToken = data.token;
        localStorage.setItem('staff_token', authToken);
        currentUser = data.user;
        renderUserHeader();
        hideLogin();
        await loadConversations();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    }

    async function doLogout() {
      if (authToken) {
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken }
          });
        } catch {}
      }
      authToken = null;
      currentUser = null;
      localStorage.removeItem('staff_token');
      showLogin();
    }

    async function fetchCurrentUser() {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + authToken }
      });
      if (!res.ok) throw new Error('Unauthorized');
      const data = await res.json();
      currentUser = data.user;
      renderUserHeader();
      hideLogin();
      await loadConversations();
    }

    function renderUserHeader() {
      if (!currentUser) return;
      document.getElementById('user-display-name').textContent = currentUser.fullName;
      const propBadge = document.getElementById('user-display-property');
      const selector = document.getElementById('property-selector');

      if (currentUser.role === 'admin') {
        propBadge.textContent = '👑 Tổng Quản Trị (Admin 3 Cơ Sở)';
        selector.disabled = false;
      } else {
        const names = {
          'j-village': 'J Village',
          'jacayl-tran-khat-chan': 'Jacayl Trần Khát Chân',
          'jacayl-ha-dong': 'Jacayl Hà Đông'
        };
        const pName = names[currentUser.propertyId] || currentUser.propertyId;
        propBadge.textContent = '🏨 ' + pName;
        selector.value = currentUser.propertyId;
        selector.disabled = true; // Lock property selection for staff
      }
    }

    function setFilterState(state, btn) {
      currentFilterState = state;
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      loadConversations();
    }

    function debounceSearch() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => loadConversations(), 300);
    }

    async function loadConversations() {
      if (!authToken) return;
      const prop = document.getElementById('property-selector').value;
      const search = document.getElementById('search-box').value;

      let url = '/api/conversations?state=' + encodeURIComponent(currentFilterState);
      if (prop) url += '&propertyId=' + encodeURIComponent(prop);
      if (search) url += '&search=' + encodeURIComponent(search);

      try {
        const res = await fetch(url, {
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const data = await res.json();
        renderConversationList(data.items || []);
      } catch (e) {
        console.error('Error loading conversations:', e);
      }
    }

    function renderConversationList(items) {
      const container = document.getElementById('conversation-list');
      if (items.length === 0) {
        container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:13px;">Không có cuộc trò chuyện nào</div>';
        return;
      }

      container.innerHTML = items.map(c => {
        const activeCls = c.id === activeConversationId ? ' active' : '';
        const unreadTag = c.unreadCountStaff > 0 ? '<span class="badge badge-unread">' + c.unreadCountStaff + '</span>' : '';
        const timeStr = new Date(c.lastMessageTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return '<div class="conv-item' + activeCls + '" onclick="selectConversation(\\'' + c.id + '\\')">' +
          '<div class="conv-top">' +
            '<span class="conv-name">' + (c.customerName || 'Khách #' + c.id.slice(0, 8)) + '</span>' +
            '<span class="conv-time">' + timeStr + '</span>' +
          '</div>' +
          '<div class="conv-snippet">' + (c.lastMessageSnippet || 'Chưa có tin nhắn') + '</div>' +
          '<div class="conv-badges">' +
            '<span class="badge badge-' + c.state + '">' + c.state + '</span>' +
            '<span class="badge badge-property">' + c.propertyId + '</span>' +
            unreadTag +
          '</div>' +
        '</div>';
      }).join('');
    }

    async function selectConversation(id) {
      activeConversationId = id;
      loadConversations(); // Re-render active highlight
      await loadConversationDetail(id);
    }

    async function loadConversationDetail(id) {
      if (!authToken || !id) return;
      try {
        const res = await fetch('/api/conversations/' + id, {
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        renderChatView(data.conversation, data.messages, data.internalNotes);
      } catch (e) {
        alert('Lỗi tải cuộc hội thoại: ' + e.message);
      }
    }

    function renderChatView(conv, messages, notes) {
      document.getElementById('chat-header').style.display = 'flex';
      document.getElementById('chat-input-bar').style.display = 'flex';

      document.getElementById('current-customer-name').textContent = conv.customerName || 'Khách #' + conv.id.slice(0, 8);
      document.getElementById('current-property-name').textContent = conv.propertyId;
      const stateBadge = document.getElementById('current-conv-state');
      stateBadge.textContent = conv.state;
      stateBadge.className = 'badge badge-' + conv.state;

      const staffAssigned = document.getElementById('current-assigned-staff');
      staffAssigned.textContent = conv.assignedStaffName ? 'Lễ tân: ' + conv.assignedStaffName : '';

      // Controls setup
      const btnTakeover = document.getElementById('btn-takeover');
      const btnResume = document.getElementById('btn-resume');
      const banner = document.getElementById('takeover-banner');
      const staffInput = document.getElementById('staff-message-input');
      const btnSendStaff = document.getElementById('btn-send-staff');

      if (conv.state === 'HUMAN_ACTIVE') {
        btnTakeover.style.display = 'none';
        btnResume.style.display = 'inline-flex';
        banner.style.display = 'flex';
        staffInput.disabled = false;
        staffInput.placeholder = 'Nhập tin nhắn lễ tân gửi tới khách...';
        btnSendStaff.disabled = false;
      } else if (conv.state === 'CLOSED') {
        btnTakeover.style.display = 'none';
        btnResume.style.display = 'none';
        banner.style.display = 'none';
        staffInput.disabled = true;
        staffInput.placeholder = 'Cuộc trò chuyện đã đóng.';
        btnSendStaff.disabled = true;
      } else {
        btnTakeover.style.display = 'inline-flex';
        btnResume.style.display = 'none';
        banner.style.display = 'none';
        staffInput.disabled = true;
        staffInput.placeholder = 'Chỉ có thể gửi tin khi đã bấm Tiếp quản (Human Takeover)';
        btnSendStaff.disabled = true;
      }

      // Reset per-render scoped lightbox album registry
      window.__roomAlbumRegistry = {};

      function escHtml(str) {
        return String(str || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      // Render Messages
      const container = document.getElementById('chat-messages');
      container.innerHTML = messages.map((m, msgIdx) => {
        let cls = 'msg-customer';
        let senderTitle = m.senderName || 'Khách hàng';
        if (m.senderType === 'ai') {
          cls = 'msg-ai';
          senderTitle = '🤖 Trợ lý AI Concierge';
        } else if (m.senderType === 'staff') {
          cls = 'msg-staff';
          senderTitle = '👔 ' + (m.senderName || 'Lễ tân');
        } else if (m.senderType === 'system') {
          cls = 'msg-system';
          return '<div class="msg-wrapper msg-system"><div class="msg-bubble">' + renderSafeMarkdown(m.content) + '</div></div>';
        }

        let telemetryHtml = '';
        if (m.metadata?.telemetry) {
          const tel = m.metadata.telemetry;
          const engLabel = tel.engine || 'agentic';
          const provModel = (tel.provider || 'unknown') + ':' + (tel.model || 'unknown');
          const statusLabel = tel.verificationStatus || (tel.isFallback ? 'DEGRADED' : 'LIVE');
          const traceLabel = tel.traceId || m.id || 'n/a';
          telemetryHtml = '<span class="telemetry-tag">engine=' + engLabel + ' | ' + provModel + ' | ' + statusLabel + ' | ' + (tel.latencyMs ?? 0) + 'ms | trace=' + traceLabel + '</span>';
        }

        let imagesGalleryHtml = '';
        const msgKey = m.id || ('msg_' + msgIdx);
        const presentations = Array.isArray(m.metadata?.roomPresentations) && m.metadata.roomPresentations.length > 0
          ? m.metadata.roomPresentations
          : null;

        if (presentations) {
          imagesGalleryHtml = '<div class="room-albums-stack">' + presentations.map((grp, grpIdx) => {
            const grpImgs = Array.isArray(grp.images) ? grp.images : [];
            if (grpImgs.length === 0) return '';
            const albumKey = msgKey + '__' + (grp.roomId || ('grp_' + grpIdx));
            const roomTitle = grp.roomName || (grp.roomCode ? ('Phòng ' + grp.roomCode) : 'Ảnh phòng');
            const albumImages = grpImgs.map((img, iIdx) => ({
              url: img.url,
              caption: img.caption || (roomTitle + ' — Ảnh ' + (iIdx + 1)),
              roomTitle,
            }));
            window.__roomAlbumRegistry[albumKey] = albumImages;

            const priceTag = grp.priceSummary ? ' · ' + escHtml(grp.priceSummary) : '';
            const headerHtml =
              '<div class="room-album-header">' +
                '<span class="room-album-title">📷 ' + escHtml(roomTitle) + '</span>' +
                '<span class="room-album-meta">' + albumImages.length + ' ảnh' + priceTag + '</span>' +
              '</div>';

            const cardsHtml = albumImages.map((item, iIdx) => {
              const cleanUrl = escHtml(item.url);
              const cleanCap = escHtml(item.caption);
              return '<div class="gallery-card" data-album-key="' + escHtml(albumKey) + '" data-index="' + iIdx + '" data-url="' + cleanUrl + '" data-caption="' + cleanCap + '" data-room-title="' + escHtml(roomTitle) + '">' +
                '<img src="' + cleanUrl + '" alt="' + cleanCap + '" class="room-thumbnail" loading="lazy" />' +
                '<div class="gallery-card-caption">' + cleanCap + '</div>' +
              '</div>';
            }).join('');

            return '<div class="room-album-block" data-room-id="' + escHtml(grp.roomId || '') + '" data-room-code="' + escHtml(grp.roomCode || '') + '">' +
              headerHtml +
              '<div class="msg-images-gallery">' + cardsHtml + '</div>' +
            '</div>';
          }).join('') + '</div>';
        } else if (m.metadata && Array.isArray(m.metadata.images) && m.metadata.images.length > 0) {
          // Backward compatibility: group only when images already carry explicit roomId+roomName metadata; otherwise keep neutral unguessed legacy album.
          const hasExplicitRoomMeta = m.metadata.images.every(img => img && (img.roomId || img.roomName));
          if (hasExplicitRoomMeta) {
            const groupedMap = new Map();
            m.metadata.images.forEach((img, idx) => {
              const rKey = img.roomId || img.roomName || ('room_' + idx);
              if (!groupedMap.has(rKey)) groupedMap.set(rKey, { roomId: img.roomId || '', roomName: img.roomName || 'Ảnh phòng', images: [] });
              groupedMap.get(rKey).images.push(img);
            });
            imagesGalleryHtml = '<div class="room-albums-stack">' + Array.from(groupedMap.entries()).map(([rKey, grp], grpIdx) => {
              const albumKey = msgKey + '__legacygrp_' + grpIdx;
              const albumImages = grp.images.map((img, iIdx) => ({
                url: img.url,
                caption: img.caption || (grp.roomName + ' — Ảnh ' + (iIdx + 1)),
                roomTitle: grp.roomName,
              }));
              window.__roomAlbumRegistry[albumKey] = albumImages;
              return '<div class="room-album-block" data-room-id="' + escHtml(grp.roomId) + '">' +
                '<div class="room-album-header"><span class="room-album-title">📷 ' + escHtml(grp.roomName) + '</span><span class="room-album-meta">' + albumImages.length + ' ảnh</span></div>' +
                '<div class="msg-images-gallery">' + albumImages.map((item, iIdx) =>
                  '<div class="gallery-card" data-album-key="' + escHtml(albumKey) + '" data-index="' + iIdx + '" data-url="' + escHtml(item.url) + '" data-caption="' + escHtml(item.caption) + '" data-room-title="' + escHtml(grp.roomName) + '">' +
                    '<img src="' + escHtml(item.url) + '" alt="' + escHtml(item.caption) + '" class="room-thumbnail" loading="lazy" />' +
                    '<div class="gallery-card-caption">' + escHtml(item.caption) + '</div>' +
                  '</div>'
                ).join('') + '</div></div>';
            }).join('') + '</div>';
          } else {
            const legacyKey = msgKey + '__legacy_flat';
            const albumImages = m.metadata.images.map((img, idx) => ({
              url: img.url,
              caption: img.caption || img.alt || ('Ảnh đính kèm #' + (idx + 1)),
              roomTitle: 'Ảnh phòng (phiên cũ)',
            }));
            window.__roomAlbumRegistry[legacyKey] = albumImages;
            imagesGalleryHtml = '<div class="room-album-block room-album-legacy">' +
              '<div class="room-album-header"><span class="room-album-title">📷 Ảnh phòng (phiên cũ)</span><span class="room-album-meta">' + albumImages.length + ' ảnh</span></div>' +
              '<div class="msg-images-gallery">' + albumImages.map((item, iIdx) =>
                '<div class="gallery-card" data-album-key="' + escHtml(legacyKey) + '" data-index="' + iIdx + '" data-url="' + escHtml(item.url) + '" data-caption="' + escHtml(item.caption) + '" data-room-title="' + escHtml(item.roomTitle) + '">' +
                  '<img src="' + escHtml(item.url) + '" alt="' + escHtml(item.caption) + '" class="room-thumbnail" loading="lazy" />' +
                  '<div class="gallery-card-caption">' + escHtml(item.caption) + '</div>' +
                '</div>'
              ).join('') + '</div></div>';
          }
        }

        const timeStr = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return '<div class="msg-wrapper ' + cls + '">' +
          '<div style="font-size:11px; color:var(--text-muted); margin-bottom:2px;">' + senderTitle + '</div>' +
          '<div class="msg-bubble">' + renderSafeMarkdown(m.content) + imagesGalleryHtml + '</div>' +
          '<div class="msg-meta">' +
            telemetryHtml +
            '<span>' + timeStr + '</span>' +
          '</div>' +
        '</div>';
      }).join('');

      container.scrollTop = container.scrollHeight;

      // Render Notes
      renderNotesList(notes);
      loadAuditLogs(conv.id);
    }

    function renderSafeMarkdown(content) {
      if (!content) return '';
      let escaped = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      escaped = escaped.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      escaped = escaped.replace(/(^|[^*])\\*([^*]+?)\\*(?!\\*)/g, '$1<em>$2</em>');
      escaped = escaped.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s'\\")]+)\\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--gold); text-decoration:underline;">$1</a>');
      escaped = escaped.replace(/(?:^|\\n)-\\s+([^\\n]+)/g, '\\n• $1');
      escaped = escaped.replace(/\\n/g, '<br>');
      return escaped;
    }

    let currentLightboxState = { albumKey: null, index: 0, items: [] };

    function renderLightboxSlide() {
      const modal = document.getElementById('lightbox-modal');
      const titleEl = document.getElementById('lightbox-room-title');
      const imgEl = document.getElementById('lightbox-img');
      const capEl = document.getElementById('lightbox-caption');
      const counterEl = document.getElementById('lightbox-counter');
      const prevBtn = document.getElementById('lightbox-prev');
      const nextBtn = document.getElementById('lightbox-next');
      const items = currentLightboxState.items || [];
      if (!modal || !imgEl || items.length === 0) return;

      const idx = Math.max(0, Math.min(currentLightboxState.index, items.length - 1));
      currentLightboxState.index = idx;
      const item = items[idx];
      if (titleEl) titleEl.textContent = item.roomTitle || '';
      imgEl.src = item.url || '';
      imgEl.alt = item.caption || item.roomTitle || 'Room image';
      if (capEl) capEl.textContent = item.caption || '';
      if (counterEl) counterEl.textContent = (idx + 1) + ' / ' + items.length;
      if (prevBtn) prevBtn.disabled = idx <= 0;
      if (nextBtn) nextBtn.disabled = idx >= items.length - 1;
      modal.style.display = 'flex';
    }

    function openLightbox(url, caption, albumKey, index, roomTitle) {
      const reg = window.__roomAlbumRegistry || {};
      const albumItems = albumKey && Array.isArray(reg[albumKey]) && reg[albumKey].length > 0
        ? reg[albumKey]
        : [{ url, caption: caption || '', roomTitle: roomTitle || '' }];
      currentLightboxState = {
        albumKey: albumKey || null,
        index: Number.isFinite(index) ? index : 0,
        items: albumItems,
      };
      renderLightboxSlide();
    }

    function navigateLightbox(delta) {
      const items = currentLightboxState.items || [];
      if (items.length === 0) return;
      const next = currentLightboxState.index + delta;
      if (next < 0 || next >= items.length) return;
      currentLightboxState.index = next;
      renderLightboxSlide();
    }

    function closeLightbox() {
      const modal = document.getElementById('lightbox-modal');
      const img = document.getElementById('lightbox-img');
      if (modal) modal.style.display = 'none';
      if (img) img.src = '';
      currentLightboxState = { albumKey: null, index: 0, items: [] };
    }

    document.addEventListener('keydown', function(e) {
      const modal = document.getElementById('lightbox-modal');
      if (!modal || modal.style.display !== 'flex') return;
      if (e.key === 'ArrowLeft') navigateLightbox(-1);
      else if (e.key === 'ArrowRight') navigateLightbox(1);
      else if (e.key === 'Escape') closeLightbox();
    });

    // Delegated click listener for gallery thumbnails (strictly scoped to clicked room's album)
    document.addEventListener('click', function(e) {
      const card = e.target.closest('.gallery-card');
      if (card && card.dataset.url) {
        const idx = parseInt(card.dataset.index || '0', 10);
        openLightbox(card.dataset.url, card.dataset.caption, card.dataset.albumKey, Number.isNaN(idx) ? 0 : idx, card.dataset.roomTitle);
      }
    });

    // Delegated error listener for images (no inline onerror attribute)
    window.addEventListener('error', function(e) {
      const target = e.target;
      if (target && target.tagName === 'IMG' && target.classList && target.classList.contains('room-thumbnail')) {
        target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90"><rect width="120" height="90" fill="%23222730"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%239aa0a6" font-size="10">Ảnh không tải được</text></svg>';
      }
    }, true);

    function renderNotesList(notes) {
      const container = document.getElementById('notes-container');
      if (!notes || notes.length === 0) {
        container.innerHTML = '<div style="font-size:12px; color:var(--text-muted); text-align:center;">Chưa có ghi chú nào</div>';
        return;
      }
      container.innerHTML = notes.map(n => {
        const timeStr = new Date(n.createdAt).toLocaleString();
        return '<div class="note-item">' +
          '<div class="note-header"><span class="note-author">' + n.staffName + '</span><span>' + timeStr + '</span></div>' +
          '<div class="note-text">' + n.content + '</div>' +
        '</div>';
      }).join('');
    }

    async function handleTakeover() {
      if (!activeConversationId) return;
      try {
        const res = await fetch('/api/conversations/' + activeConversationId + '/takeover', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        await loadConversationDetail(activeConversationId);
        loadConversations();
      } catch (e) {
        alert('Lỗi tiếp quản: ' + e.message);
      }
    }

    async function handleResumeAI() {
      if (!activeConversationId) return;
      try {
        const res = await fetch('/api/conversations/' + activeConversationId + '/resume-ai', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        await loadConversationDetail(activeConversationId);
        loadConversations();
      } catch (e) {
        alert('Lỗi mở lại AI: ' + e.message);
      }
    }

    async function handleCloseConversation() {
      if (!activeConversationId) return;
      if (!confirm('Bạn có chắc muốn đóng cuộc trò chuyện này không?')) return;
      try {
        const res = await fetch('/api/conversations/' + activeConversationId + '/close', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        await loadConversationDetail(activeConversationId);
        loadConversations();
      } catch (e) {
        alert('Lỗi đóng cuộc trò chuyện: ' + e.message);
      }
    }

    async function sendStaffMessage() {
      if (!activeConversationId) return;
      const input = document.getElementById('staff-message-input');
      const text = input.value.trim();
      if (!text) return;

      const clientMsgId = 'client_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

      try {
        const res = await fetch('/api/conversations/' + activeConversationId + '/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + authToken
          },
          body: JSON.stringify({ content: text, clientMessageId: clientMsgId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        input.value = '';
        await loadConversationDetail(activeConversationId);
        loadConversations();
      } catch (e) {
        alert('Lỗi gửi tin nhắn: ' + e.message);
      }
    }

    async function addInternalNote() {
      if (!activeConversationId) {
        alert('Vui lòng chọn một cuộc trò chuyện trước khi thêm ghi chú.');
        return;
      }
      const input = document.getElementById('new-note-text');
      const text = input.value.trim();
      if (!text) return;

      try {
        const res = await fetch('/api/conversations/' + activeConversationId + '/notes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + authToken
          },
          body: JSON.stringify({ content: text })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        input.value = '';
        await loadConversationDetail(activeConversationId);
      } catch (e) {
        alert('Lỗi thêm ghi chú: ' + e.message);
      }
    }

    function switchToolTab(tab, btn) {
      document.querySelectorAll('.tool-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tool-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + tab).classList.add('active');
    }

    function setSimQuestion(q) {
      document.getElementById('sim-input-text').value = q;
    }

    async function sendSimulatedCustomerMessage() {
      const convId = activeConversationId || 'sim_' + Date.now();
      const propId = document.getElementById('sim-property-select').value;
      const text = document.getElementById('sim-input-text').value.trim();
      if (!text) {
        alert('Vui lòng nhập nội dung câu hỏi của khách.');
        return;
      }

      const clientMsgId = 'sim_msg_' + Date.now();

      try {
        const res = await fetch('/api/simulate/customer-turn', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + authToken
          },
          body: JSON.stringify({
            conversationId: convId,
            propertyId: propId,
            content: text,
            clientMessageId: clientMsgId,
            customerName: 'Khách Demo (' + propId + ')'
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        document.getElementById('sim-input-text').value = '';
        activeConversationId = convId;
        await loadConversations();
        await loadConversationDetail(convId);
      } catch (e) {
        alert('Lỗi gửi tin giả lập: ' + e.message);
      }
    }

    async function loadAuditLogs(convId) {
      try {
        const res = await fetch('/api/audit-logs?conversationId=' + convId, {
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const data = await res.json();
        const container = document.getElementById('audit-container');
        if (!data.items || data.items.length === 0) {
          container.innerHTML = '<div style="font-size:12px; color:var(--text-muted); text-align:center;">Chưa có log thao tác</div>';
          return;
        }
        container.innerHTML = data.items.map(l => {
          const timeStr = new Date(l.timestamp).toLocaleTimeString();
          return '<div style="border-bottom:1px solid var(--border); padding:6px 0; font-size:11.5px;">' +
            '<div style="display:flex; justify-content:space-between; color:var(--gold); font-weight:600;">' +
              '<span>' + l.action + '</span>' +
              '<span style="color:var(--text-muted);">' + timeStr + '</span>' +
            '</div>' +
            '<div style="color:var(--text-muted);">' + l.staffName + (l.details ? ' — ' + JSON.stringify(l.details) : '') + '</div>' +
          '</div>';
        }).join('');
      } catch {}
    }

    async function openTelemetryModal() {
      const modal = document.getElementById('telemetry-modal');
      modal.style.display = 'flex';
      const container = document.getElementById('telemetry-content');
      container.innerHTML = 'Đang truy vấn telemetry API...';

      try {
        const res = await fetch('/api/telemetry', {
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const data = await res.json();
        const gt = data.groundingTelemetry || {};
        container.innerHTML = '<div style="display:flex; flex-direction:column; gap:12px;">' +
          '<div><strong>Engine:</strong> ' + (data.engine || 'agentic') + ' | <strong>Build Version:</strong> ' + (data.buildVersion || '3.0.0-llm-native-final') + ' | <strong>Commit:</strong> <code>' + (data.gitCommit || 'unknown') + '</code> | <strong>Policy:</strong> V' + (data.effectivePolicyVersion || '1.4.6') + '</div>' +
          '<div><strong>Active Mode:</strong> ' + data.activeMode + ' | <strong>Free Only:</strong> ' + data.freeOnlyMode + '</div>' +
          '<div style="background:var(--bg-card); padding:10px; border-radius:6px; border:1px solid var(--border);">' +
            '<strong style="color:var(--gold);">Business Grounding Telemetry:</strong> Last: <code>' + (gt.lastGroundingStatus || 'NOT_EVALUATED') + '</code> | Verified: <strong>' + (gt.verifiedTurns ?? 0) + '</strong> | Repaired: <strong>' + (gt.repairedTurns ?? 0) + '</strong> | Blocked: <strong>' + (gt.blockedTurns ?? 0) + '</strong>' +
          '</div>' +
          (data.recommendedRouting ? '<div style="font-size:12px; color:var(--text-muted);"><strong>Routing:</strong> ' + data.recommendedRouting + '</div>' : '') +
          '<div style="background:var(--bg-card); padding:10px; border-radius:6px; border:1px solid var(--border);">' +
            '<strong style="color:var(--gold);">Google Gemini Provider (Primary):</strong> ' + (data.gemini.configured ? '✅ Đã cấu hình' : '❌ Chưa cấu hình') + '<br>' +
            'Model: <code>' + data.gemini.model + '</code> | Fallback: <code>gemini-3.1-flash-lite</code><br>' +
            'Rate Limit Cooloff: ' + data.gemini.rateLimitCooloffSecRemaining + 's' +
          '</div>' +
          '<div style="background:var(--bg-card); padding:10px; border-radius:6px; border:1px solid var(--border);">' +
            '<strong style="color:var(--gold);">Groq Provider (Secondary):</strong> ' + (data.groq.configured ? '✅ Đã cấu hình' : '❌ Chưa cấu hình') + '<br>' +
            'Model: <code>' + data.groq.model + '</code><br>' +
            'Rate Limit Cooloff: ' + data.groq.rateLimitCooloffSecRemaining + 's' +
          '</div>' +
          '<div style="background:var(--bg-card); padding:10px; border-radius:6px; border:1px solid var(--border);">' +
            '<strong style="color:var(--gold);">Deterministic Mock Engine:</strong> ✅ Sẵn sàng (Zero Cost, Deterministic Invariants)' +
          '</div>' +
        '</div>';
      } catch (e) {
        container.textContent = 'Lỗi truy vấn: ' + e.message;
      }
    }

    function closeTelemetryModal() {
      document.getElementById('telemetry-modal').style.display = 'none';
    }
  </script>
</body>
</html>`;
}
