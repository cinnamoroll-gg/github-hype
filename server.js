const http = require('http');
const https = require('https');

// Configuration from environment variables
const INFERENCE_BASE_URL = process.env.INFERENCE_BASE_URL || 'http://localhost:8081/v1';
const INFERENCE_MODEL = process.env.INFERENCE_MODEL || 'unsloth/Qwen3-Coder-Next-GGUF:Q6_K';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// In-memory token tracking
const tokenStats = { requests: 0, promptTokens: 0, completionTokens: 0 };

// Log configuration at startup
console.log('🔥 HYPE MACHINE starting...');
console.log(`  INFERENCE_BASE_URL: ${INFERENCE_BASE_URL}`);
console.log(`  INFERENCE_MODEL: ${INFERENCE_MODEL}`);
console.log(`  GITHUB_TOKEN: ${GITHUB_TOKEN ? 'configured (optional)' : 'not set (rate limits may apply)'}`);

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'User-Agent': 'hype-web' } };
    
    // Add GitHub token if configured
    if (GITHUB_TOKEN) {
      options.headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    }
    
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 404) return reject(new Error('User not found'));
        if (res.statusCode !== 200) return reject(new Error(`GitHub API returned ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function generateHype(user, repos) {
  const name = String(user.name || user.login || 'Mystery Dev');
  const login = String(user.login || '???');
  const bio = user.bio ? String(user.bio) : null;
  const publicRepos = Number(user.public_repos) || 0;
  const followers = Number(user.followers) || 0;
  const following = Number(user.following) || 0;
  const createdAt = user.created_at ? new Date(user.created_at) : null;
  const location = user.location ? String(user.location) : null;
  const company = user.company ? String(user.company) : null;
  const hireable = user.hireable;
  const avatarUrl = user.avatar_url ? String(user.avatar_url) : null;

  // Build context from GitHub profile
  const profileContext = `
GitHub Profile:
Name: ${name}
Username: @${login}
Bio: ${bio || 'None'}
Location: ${location || 'None'}
Company: ${company || 'None'}
Hireable: ${hireable ? 'Yes' : 'No'}
Avatar: ${avatarUrl || 'None'}
Created: ${createdAt ? createdAt.toISOString().split('T')[0] : 'Unknown'}
Repos: ${publicRepos}
Followers: ${followers}
Following: ${following}
`;

  // Build top repos context
  let reposContext = '\nTop 5 Repos:\n';
  const topRepos = repos
    .filter(r => !r.fork)
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
    .slice(0, 5);

  if (topRepos.length === 0) {
    reposContext += 'No public repos (all private or none)';
  } else {
    for (const repo of topRepos) {
      const stars = Number(repo.stargazers_count) || 0;
      const repoName = String(repo.name || 'unnamed');
      const lang = repo.language ? String(repo.language) : 'Unknown';
      const desc = repo.description ? String(repo.description).slice(0, 100) : 'No description';
      reposContext += `- ${repoName} (${lang}) - ${stars} stars: ${desc}\n`;
    }
  }

  const prompt = `You are a funny, sarcastic roast master. Use the following GitHub profile and top repos context to write a funny, punchy roast of this developer.

Context:
${profileContext}
${reposContext}

Return your roast as a JSON array of objects. Each object must have:
- "emoji": A relevant emoji (e.g., 🏆, 👻, 🚀, 💅, 🤣)
- "text": The roast line (short, punchy, funny)
- "color": MUST be one of these exact strings: green, yellow, cyan, red, magenta

Return ONLY valid JSON. No markdown formatting. No extra text. Just the JSON array.

Roast them funny but not mean. Be playful and witty.`;

  try {
    const response = await fetch(`${INFERENCE_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: INFERENCE_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a funny, sarcastic roast master. Return ONLY valid JSON arrays. No markdown, no extra text.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 1000,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Qwen API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Track token usage
    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;
    tokenStats.requests++;
    tokenStats.promptTokens += promptTokens;
    tokenStats.completionTokens += completionTokens;
    
    console.log(`  Qwen API tokens: prompt=${promptTokens}, completion=${completionTokens}`);

    let roastLines = [];

    // Handle different response formats
    if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
      const content = data.choices[0].message.content.trim();
      
      // Qwen returns the JSON array as a string inside content
      // Try to parse JSON directly first (plain JSON string)
      try {
        roastLines = JSON.parse(content);
      } catch (parseError) {
        // Try to parse JSON from content (might be wrapped in markdown)
        let jsonStr = content;
        if (content.startsWith('```json')) {
          jsonStr = content.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (content.startsWith('```')) {
          jsonStr = content.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        
        try {
          roastLines = JSON.parse(jsonStr);
        } catch (parseError2) {
          // Fallback: create a single roast line with the raw content
          roastLines = [
            { emoji: '🤣', text: content, color: 'magenta' }
          ];
        }
      }
    } else if (Array.isArray(data)) {
      roastLines = data;
    } else {
      throw new Error('Unexpected API response format');
    }

    // Filter valid roast lines
    roastLines = roastLines
      .filter(line => line && typeof line.text === 'string' && line.text.length > 0)
      .map(line => ({
        emoji: line.emoji || '🔥',
        text: line.text,
        color: ["green","yellow","cyan","red","magenta"].includes(line.color) ? line.color : "cyan"
      }));

    // If no roasts generated, add a fallback
    if (roastLines.length === 0) {
      roastLines.push({ emoji: '🔥', text: 'This profile needs more activity to roast properly!', color: 'yellow' });
    }

    const lines = [];

    // Header
    lines.push({ type: 'header', text: '🔥 HYPE MACHINE 🔥' });
    lines.push({ type: 'profile', name, login, bio, location, company, avatarUrl });

    // Stats
    lines.push({ type: 'stats', repos: publicRepos, followers, following });

    // Roasts from AI
    lines.push({ type: 'roasts', items: roastLines });

    // Top repos
    if (topRepos.length > 0) {
      const repoItems = topRepos.map(repo => {
        const stars = Number(repo.stargazers_count) || 0;
        const repoName = String(repo.name || 'unnamed');
        const lang = repo.language ? String(repo.language) : 'Mystery Language';
        const desc = repo.description ? String(repo.description).slice(0, 60) : 'no description';
        return { name: repoName, lang, stars, desc, url: repo.html_url ? String(repo.html_url) : null };
      });

      lines.push({ type: 'repos', items: repoItems, extraRoasts: [] });
    }

    return lines;

  } catch (err) {
    console.error('Error calling Qwen API:', err);
    // Fallback to simple roast if API fails
    const lines = [
      { type: 'header', text: '🔥 HYPE MACHINE 🔥' },
      { type: 'profile', name, login, bio, location, company, avatarUrl },
      { type: 'stats', repos: publicRepos, followers, following },
      { type: 'roasts', items: [
        { emoji: '⚠️', text: `API roast failed: ${err.message}. The Qwen API might be down!`, color: 'red' },
        { emoji: '🔥', text: 'But you still code like a legend! Keep pushing!', color: 'green' }
      ]}
    ];

    if (topRepos.length > 0) {
      const repoItems = topRepos.map(repo => ({
        name: repo.name,
        lang: repo.language || 'Unknown',
        stars: Number(repo.stargazers_count) || 0,
        desc: repo.description ? String(repo.description).slice(0, 60) : 'no description',
        url: repo.html_url || null
      }));
      lines.push({ type: 'repos', items: repoItems, extraRoasts: [] });
    }

    return lines;
  }
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🔥 HYPE MACHINE</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@400;700&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: #0a0a0f;
    color: #e0e0e0;
    font-family: 'Space Grotesk', sans-serif;
    min-height: 100vh;
    overflow-x: hidden;
  }

  body::before {
    content: '';
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background:
      radial-gradient(ellipse at 20% 50%, rgba(120, 0, 255, 0.08) 0%, transparent 50%),
      radial-gradient(ellipse at 80% 20%, rgba(255, 0, 120, 0.06) 0%, transparent 50%),
      radial-gradient(ellipse at 50% 80%, rgba(0, 200, 255, 0.05) 0%, transparent 50%);
    pointer-events: none;
    z-index: 0;
  }

  .container {
    max-width: 700px;
    margin: 0 auto;
    padding: 40px 20px;
    position: relative;
    z-index: 1;
  }

  .title {
    text-align: center;
    font-size: 3rem;
    font-weight: 700;
    margin-bottom: 8px;
    background: linear-gradient(135deg, #ff6b6b, #ffa500, #ffee00, #48ff00, #00d4ff, #b44dff, #ff6b6b);
    background-size: 300% 300%;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: rainbow 4s ease infinite;
  }

  @keyframes rainbow {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }

  .subtitle {
    text-align: center;
    color: #666;
    margin-bottom: 32px;
    font-size: 0.9rem;
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  .input-row {
    display: flex;
    gap: 12px;
    margin-bottom: 40px;
  }

  .input-row input {
    flex: 1;
    background: #14141f;
    border: 2px solid #2a2a3a;
    border-radius: 12px;
    padding: 14px 20px;
    color: #fff;
    font-size: 1.1rem;
    font-family: 'JetBrains Mono', monospace;
    outline: none;
    transition: border-color 0.3s, box-shadow 0.3s;
  }

  .input-row input:focus {
    border-color: #b44dff;
    box-shadow: 0 0 20px rgba(180, 77, 255, 0.15);
  }

  .input-row input::placeholder { color: #444; }

  .hype-btn {
    background: linear-gradient(135deg, #ff6b6b, #ff8e53, #ffa500);
    border: none;
    border-radius: 12px;
    padding: 14px 32px;
    color: #fff;
    font-size: 1.1rem;
    font-weight: 700;
    font-family: 'Space Grotesk', sans-serif;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
    white-space: nowrap;
    letter-spacing: 1px;
  }

  .hype-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(255, 107, 107, 0.3);
  }

  .hype-btn:active { transform: translateY(0); }

  .hype-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  .loading {
    text-align: center;
    padding: 60px 0;
    font-size: 1.5rem;
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }

  .error {
    text-align: center;
    padding: 40px;
    background: rgba(255, 50, 50, 0.08);
    border: 1px solid rgba(255, 50, 50, 0.2);
    border-radius: 16px;
    color: #ff6b6b;
    font-size: 1.1rem;
  }

  .card {
    background: #12121c;
    border: 1px solid #1e1e2e;
    border-radius: 20px;
    overflow: hidden;
    animation: slideUp 0.5s ease;
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .card-header {
    background: linear-gradient(135deg, #1a1a2e, #16213e);
    padding: 28px;
    text-align: center;
    border-bottom: 1px solid #1e1e2e;
  }

  .card-header h2 {
    font-size: 1.6rem;
    background: linear-gradient(135deg, #ff6b6b, #ffa500);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 4px;
  }

  .profile {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 24px 28px;
    border-bottom: 1px solid #1a1a2a;
  }

  .avatar {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    border: 3px solid #b44dff;
    box-shadow: 0 0 20px rgba(180, 77, 255, 0.2);
  }

  .profile-info h3 {
    font-size: 1.3rem;
    color: #fff;
  }

  .profile-info .login {
    color: #666;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.9rem;
  }

  .profile-info .bio {
    color: #999;
    margin-top: 4px;
    font-size: 0.9rem;
    font-style: italic;
  }

  .profile-info .meta {
    color: #555;
    font-size: 0.8rem;
    margin-top: 4px;
  }

  .stats-row {
    display: flex;
    justify-content: space-around;
    padding: 20px 28px;
    border-bottom: 1px solid #1a1a2a;
  }

  .stat {
    text-align: center;
  }

  .stat-value {
    font-size: 1.6rem;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
  }

  .stat-value.green { color: #48ff00; }
  .stat-value.yellow { color: #ffee00; }
  .stat-value.blue { color: #00d4ff; }

  .stat-label {
    font-size: 0.75rem;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-top: 2px;
  }

  .roasts {
    padding: 24px 28px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .roast {
    padding: 12px 16px;
    border-radius: 10px;
    font-size: 0.95rem;
    line-height: 1.5;
    animation: fadeIn 0.4s ease;
    animation-fill-mode: both;
  }

  .roast:nth-child(1) { animation-delay: 0.1s; }
  .roast:nth-child(2) { animation-delay: 0.2s; }
  .roast:nth-child(3) { animation-delay: 0.3s; }
  .roast:nth-child(4) { animation-delay: 0.4s; }
  .roast:nth-child(5) { animation-delay: 0.5s; }
  .roast:nth-child(6) { animation-delay: 0.6s; }
  .roast:nth-child(7) { animation-delay: 0.7s; }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateX(-10px); }
    to { opacity: 1; transform: translateX(0); }
  }

  .roast.green { background: rgba(72, 255, 0, 0.06); border-left: 3px solid #48ff00; color: #a0ffb0; }
  .roast.yellow { background: rgba(255, 238, 0, 0.06); border-left: 3px solid #ffee00; color: #fff3a0; }
  .roast.cyan { background: rgba(0, 212, 255, 0.06); border-left: 3px solid #00d4ff; color: #a0e8ff; }
  .roast.red { background: rgba(255, 107, 107, 0.06); border-left: 3px solid #ff6b6b; color: #ffa0a0; }
  .roast.magenta { background: rgba(180, 77, 255, 0.06); border-left: 3px solid #b44dff; color: #d4a0ff; }

  .roast .emoji { margin-right: 8px; }

  .repos-section {
    padding: 0 28px 24px;
  }

  .repos-title {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: #555;
    margin-bottom: 12px;
    padding-top: 8px;
    border-top: 1px solid #1a1a2a;
  }

  .repo {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 12px 14px;
    background: #0e0e18;
    border-radius: 10px;
    margin-bottom: 8px;
    transition: background 0.2s;
  }

  .repo:hover { background: #16162a; }

  .repo-left { flex: 1; min-width: 0; }

  .repo-name {
    font-weight: 700;
    color: #00d4ff;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.95rem;
    text-decoration: none;
  }

  .repo-name:hover { text-decoration: underline; }

  .repo-lang {
    font-size: 0.75rem;
    color: #666;
    margin-left: 8px;
  }

  .repo-desc {
    color: #555;
    font-size: 0.8rem;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .repo-stars {
    color: #ffee00;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
    white-space: nowrap;
    margin-left: 12px;
  }

  .footer {
    text-align: center;
    padding: 20px;
    color: #333;
    font-size: 0.8rem;
    border-top: 1px solid #1a1a2a;
  }
</style>
</head>
<body>
<div class="container">
  <div class="title">🔥 HYPE MACHINE 🔥</div>
  <div class="subtitle">GitHub Profile Roaster</div>
  <div class="input-row">
    <input type="text" id="username" placeholder="Enter GitHub username..." autocomplete="off" />
    <button class="hype-btn" id="hypeBtn" onclick="doHype()">HYPE ME</button>
  </div>
  <div id="output"></div>
</div>
<script>
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

document.getElementById('username').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') doHype();
});

async function doHype() {
  const input = document.getElementById('username');
  const btn = document.getElementById('hypeBtn');
  const out = document.getElementById('output');
  const username = input.value.trim();
  if (!username) { input.focus(); return; }

  btn.disabled = true;
  out.innerHTML = '<div class="loading">⏳ Looking up @' + esc(username) + '...</div>';

  try {
    const res = await fetch('/api/hype?username=' + encodeURIComponent(username));
    const data = await res.json();
    if (data.error) { out.innerHTML = '<div class="error">❌ ' + esc(data.error) + '</div>'; return; }
    renderHype(data);
  } catch (e) {
    out.innerHTML = '<div class="error">❌ Something went wrong. Try again!</div>';
  } finally {
    btn.disabled = false;
  }
}

function renderHype(sections) {
  const out = document.getElementById('output');
  let html = '<div class="card">';

  for (const s of sections) {
    if (s.type === 'header') {
      html += '<div class="card-header"><h2>' + esc(s.text) + '</h2></div>';
    } else if (s.type === 'profile') {
      html += '<div class="profile">';
      if (s.avatarUrl) html += '<img class="avatar" src="' + esc(s.avatarUrl) + '" alt="avatar" />';
      html += '<div class="profile-info">';
      html += '<h3>' + esc(s.name) + '</h3>';
      html += '<div class="login">@' + esc(s.login) + '</div>';
      if (s.bio) html += '<div class="bio">"' + esc(s.bio) + '"</div>';
      const meta = [s.location, s.company].filter(Boolean).map(esc).join(' · ');
      if (meta) html += '<div class="meta">📍 ' + meta + '</div>';
      html += '</div></div>';
    } else if (s.type === 'stats') {
      html += '<div class="stats-row">';
      html += '<div class="stat"><div class="stat-value green">' + s.repos + '</div><div class="stat-label">Repos</div></div>';
      html += '<div class="stat"><div class="stat-value yellow">' + s.followers + '</div><div class="stat-label">Followers</div></div>';
      html += '<div class="stat"><div class="stat-value blue">' + s.following + '</div><div class="stat-label">Following</div></div>';
      html += '</div>';
    } else if (s.type === 'roasts') {
      html += '<div class="roasts">';
      for (const r of s.items) {
        html += '<div class="roast ' + esc(r.color) + '"><span class="emoji">' + r.emoji + '</span>' + esc(r.text) + '</div>';
      }
      html += '</div>';
    } else if (s.type === 'repos') {
      html += '<div class="repos-section">';
      html += '<div class="repos-title">Top Repos</div>';
      for (const r of s.items) {
        html += '<div class="repo"><div class="repo-left">';
        if (r.url) html += '<a class="repo-name" href="' + esc(r.url) + '" target="_blank">' + esc(r.name) + '</a>';
        else html += '<span class="repo-name">' + esc(r.name) + '</span>';
        html += '<span class="repo-lang">' + esc(r.lang) + '</span>';
        html += '<div class="repo-desc">' + esc(r.desc) + '</div>';
        html += '</div><div class="repo-stars">' + r.stars + ' ★</div></div>';
      }
      if (s.extraRoasts && s.extraRoasts.length) {
        html += '<div class="roasts" style="padding:12px 0 0">';
        for (const r of s.extraRoasts) {
          html += '<div class="roast ' + esc(r.color) + '"><span class="emoji">' + r.emoji + '</span>' + esc(r.text) + '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
  }

  html += '<div class="footer">Powered by vibes & the GitHub API ✨</div>';
  html += '</div>';
  out.innerHTML = html;
}
</script>
</body>
</html>`;

// Helper to get client IP from headers
function getClientIP(req) {
  return req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || 'unknown';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const startTime = Date.now();
  const clientIP = getClientIP(req);
  const queryString = url.searchParams.toString() ? `?${url.searchParams.toString()}` : '';
  
  // Log basic request info
  console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname}${queryString} - IP: ${clientIP}`);

  if (url.pathname === '/api/hype' && req.method === 'GET') {
    const username = url.searchParams.get('username');
    if (!username) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing username parameter' }));
    }

    try {
      const [user, repos] = await Promise.all([
        fetchJSON(`https://api.github.com/users/${encodeURIComponent(username)}`),
        fetchJSON(`https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=stars`),
      ]);
      const hype = await generateHype(user, repos);
      const duration = Date.now() - startTime;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(hype));
      // Log hype-specific info
      console.log(`  /api/hype @${username} - ${duration}ms`);
    console.log(`  Token stats: requests=${tokenStats.requests}, prompt=${tokenStats.promptTokens}, completion=${tokenStats.completionTokens}`);
    } catch (err) {
      const duration = Date.now() - startTime;
      const status = err.message === 'User not found' ? 404 : 502;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      // Log hype-specific info for errors too
      console.log(`  /api/hype @${username} - ${duration}ms - ERROR: ${err.message}`);
      console.log(`  Token stats: requests=${tokenStats.requests}, prompt=${tokenStats.promptTokens}, completion=${tokenStats.completionTokens}`);
    }
  } else if (url.pathname === '/stats' && req.method === 'GET') {
    const totalTokens = tokenStats.promptTokens + tokenStats.completionTokens;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      totalRequests: tokenStats.requests,
      totalTokens: totalTokens,
      promptTokens: tokenStats.promptTokens,
      completionTokens: tokenStats.completionTokens
    }));
  } else if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(3000, () => {
  console.log('🔥 HYPE MACHINE running at http://localhost:3000');
  console.log('🔥 Inference backend:', INFERENCE_BASE_URL);
  console.log('🔥 Model:', INFERENCE_MODEL);
});
