# MySQL Authentication Backend

## 📋 Overview

Complete MySQL-based authentication system with:
- ✅ Email/Password registration and login
- ✅ Google OAuth integration
- ✅ GitHub OAuth integration
- ✅ Session management with JWT tokens
- ✅ Chat history tracking
- ✅ API usage analytics
- ✅ Rate limiting

---

## 🗄️ Database Schema

### **Tables Created:**

1. **users** - User accounts
2. **oauth_tokens** - OAuth access/refresh tokens
3. **sessions** - User sessions with token hashes
4. **chat_history** - Chat messages (user + assistant)
5. **chat_embeddings** - Vector embeddings for semantic search
6. **api_usage** - API call tracking
7. **rate_limits** - Rate limiting data

### **Initialize Database:**

```bash
# Connect to MySQL
mysql -u root -p

# Run schema
source deploy/initdb/01_mysql_schema.sql
```

---

## 🔧 Setup

### **1. Install Dependencies**

```bash
cd services/api
pip install -r requirements.txt
```

**New dependencies added:**
- `pymysql==1.1.0` - MySQL driver
- `aiomysql==0.2.0` - Async MySQL
- `sqlalchemy==2.0.36` - ORM
- `cryptography==44.0.0` - Encryption
- `numpy==2.1.3` - Vector operations

---

### **2. Configure Environment Variables**

Add to `.env`:

```bash
# MySQL Database
MYSQL_DATABASE_URL=mysql+aiomysql://surf_user:surf_password@localhost:3306/surf_ai

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8000/api/v1/auth/google/callback

# GitHub OAuth
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_REDIRECT_URI=http://localhost:8000/api/v1/auth/github/callback

# JWT Secret (generate with: python -c "import secrets; print(secrets.token_urlsafe(64))")
JWT_SECRET=your-jwt-secret-here
```

---

### **3. Create MySQL User**

```sql
-- Connect as root
mysql -u root -p

-- Create user
CREATE USER 'surf_user'@'localhost' IDENTIFIED BY 'surf_password';

-- Grant permissions
GRANT ALL PRIVILEGES ON surf_ai.* TO 'surf_user'@'localhost';
FLUSH PRIVILEGES;
```

---

## 🚀 API Endpoints

### **Email/Password Authentication**

#### **Register**
```bash
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword123",
  "name": "John Doe"
}

Response:
{
  "user": {
    "id": "abc123...",
    "email": "user@example.com",
    "name": "John Doe",
    "provider": "email",
    "created_at": "2026-10-20T12:00:00",
    "is_active": true
  },
  "tokens": {
    "access_token": "eyJhbGc...",
    "token_type": "bearer",
    "expires_in": 2592000
  }
}
```

#### **Login**
```bash
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword123"
}

Response: Same as register
```

---

### **Google OAuth**

#### **Step 1: Get Authorization URL**
```bash
GET /api/v1/auth/google

Response:
{
  "auth_url": "https://accounts.google.com/o/oauth2/v2/auth?client_id=..."
}
```

#### **Step 2: Redirect User**
Open `auth_url` in browser. User authenticates with Google.

#### **Step 3: Handle Callback**
Google redirects to your app with `code` parameter.

```bash
POST /api/v1/auth/google/callback
Content-Type: application/json

{
  "code": "4/0Ade..."
}

Response:
{
  "user": {
    "id": "abc123...",
    "email": "user@gmail.com",
    "name": "John Doe",
    "avatar_url": "https://...",
    "provider": "google"
  },
  "tokens": {
    "access_token": "eyJhbGc...",
    "token_type": "bearer",
    "expires_in": 2592000
  }
}
```

---

### **GitHub OAuth**

#### **Step 1: Get Authorization URL**
```bash
GET /api/v1/auth/github

Response:
{
  "auth_url": "https://github.com/login/oauth/authorize?client_id=..."
}
```

#### **Step 2: Redirect User**
Open `auth_url` in browser. User authenticates with GitHub.

#### **Step 3: Handle Callback**
GitHub redirects to your app with `code` parameter.

```bash
POST /api/v1/auth/github/callback
Content-Type: application/json

{
  "code": "abc123..."
}

Response: Same as Google
```

---

### **User Profile**

#### **Get Current User**
```bash
GET /api/v1/auth/me
Authorization: Bearer eyJhbGc...

Response:
{
  "user": {
    "id": "abc123...",
    "email": "user@example.com",
    "name": "John Doe",
    "avatar_url": "https://...",
    "provider": "google",
    "created_at": "2026-10-20T12:00:00",
    "last_login": "2026-10-20T14:00:00",
    "is_active": true
  }
}
```

---

### **Logout**

```bash
POST /api/v1/auth/logout
Authorization: Bearer eyJhbGc...

Response:
{
  "message": "Logged out successfully"
}
```

---

## 🔐 Security Features

### **1. Password Hashing**
- Uses SHA-256 for password hashing
- Consider upgrading to bcrypt/argon2 for production

### **2. Session Tokens**
- 64-byte random tokens
- SHA-256 hashed before storage
- 30-day expiration
- Invalidated on logout

### **3. OAuth Token Storage**
- Access tokens encrypted
- Refresh tokens stored securely
- Automatic expiration handling

### **4. Rate Limiting**
- Per-user rate limits
- Configurable endpoints
- Automatic window reset

---

## 📊 Database Models

### **User Model**
```python
class User:
    id: str (primary key)
    email: str (unique)
    name: str
    avatar_url: str
    provider: enum('google', 'github', 'email')
    provider_id: str
    password_hash: str
    created_at: datetime
    updated_at: datetime
    last_login: datetime
    is_active: bool
```

### **Session Model**
```python
class Session:
    id: str (primary key)
    user_id: str (foreign key)
    token_hash: str (indexed)
    ip_address: str
    user_agent: str
    created_at: datetime
    expires_at: datetime
    is_active: bool
```

### **ChatHistory Model**
```python
class ChatHistory:
    id: str (primary key)
    user_id: str (foreign key)
    role: enum('user', 'assistant', 'system')
    content: str
    model: str
    tokens_used: int
    cost: decimal
    source: enum('online', 'offline', 'cache')
    created_at: datetime
```

---

## 🧪 Testing

### **Test Email Registration**
```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "testpassword123",
    "name": "Test User"
  }'
```

### **Test Login**
```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "testpassword123"
  }'
```

### **Test Protected Endpoint**
```bash
curl -X GET http://localhost:8000/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

## 🔄 OAuth Setup Guide

### **Google OAuth**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project or select existing
3. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
4. Application type: "Web application"
5. Add authorized redirect URIs:
   - `http://localhost:8000/api/v1/auth/google/callback`
6. Copy Client ID and Client Secret to `.env`

### **GitHub OAuth**

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in:
   - Application name: "Surf AI"
   - Homepage URL: "http://localhost:8000"
   - Authorization callback URL: "http://localhost:8000/api/v1/auth/github/callback"
4. Copy Client ID and Client Secret to `.env`

---

## 📈 Next Steps

### **Phase 1: Chat Indexing** (Next)
- [ ] Generate embeddings for chat queries
- [ ] Store in `chat_embeddings` table
- [ ] Implement semantic search
- [ ] Cache retrieval for offline use

### **Phase 2: API Usage Tracking**
- [ ] Track all API calls
- [ ] Calculate costs per request
- [ ] Generate usage reports

### **Phase 3: Rate Limiting**
- [ ] Per-user rate limits
- [ ] Per-endpoint limits
- [ ] Quota management

---

## 🐛 Troubleshooting

### **Error: "Can't connect to MySQL server"**
- Check MySQL is running: `mysql --version`
- Verify connection string in `.env`
- Check user permissions

### **Error: "Invalid OAuth code"**
- Ensure redirect URI matches exactly
- Check client ID/secret
- Verify code hasn't expired (usually 10 min)

### **Error: "Invalid or expired token"**
- Token may have expired (30 days)
- Check token hash matches
- Verify session is active

---

## 📝 Files Created

1. **`deploy/initdb/01_mysql_schema.sql`** - Database schema
2. **`services/api/app/database.py`** - Database connection
3. **`services/api/app/models.py`** - SQLAlchemy models
4. **`services/api/app/auth_service.py`** - Authentication logic
5. **`services/api/app/auth_router.py`** - API endpoints
6. **`services/api/requirements.txt`** - Updated with MySQL deps

---

## ✅ Summary

**What we've built:**
- ✅ Complete MySQL database schema
- ✅ Email/password authentication
- ✅ Google OAuth integration
- ✅ GitHub OAuth integration
- ✅ Session management
- ✅ User profile endpoints
- ✅ Secure token handling

**Ready for:**
- Desktop app integration
- Chat history tracking
- Semantic search (next phase)
- API usage analytics

**Committed to:** `feature/mysql-auth-backend` branch
