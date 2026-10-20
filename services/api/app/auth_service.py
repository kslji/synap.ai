"""Authentication service with OAuth support (Google, GitHub)."""
import hashlib
import os
import secrets
from datetime import datetime, timedelta
from typing import Optional

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import User, OAuthToken, Session as SessionModel


# OAuth configuration
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/v1/auth/google/callback")

GITHUB_CLIENT_ID = os.environ.get("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.environ.get("GITHUB_CLIENT_SECRET", "")
GITHUB_REDIRECT_URI = os.environ.get("GITHUB_REDIRECT_URI", "http://localhost:8000/api/v1/auth/github/callback")

JWT_SECRET = os.environ.get("JWT_SECRET", secrets.token_urlsafe(64))
SESSION_DURATION_DAYS = 30


class AuthService:
    """Authentication service."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Email/Password Authentication
    # ============================================

    async def register_email(self, email: str, password: str, name: Optional[str] = None) -> dict:
        """Register a new user with email/password."""
        # Check if user already exists
        result = await self.db.execute(
            select(User).where(User.email == email)
        )
        existing_user = result.scalar_one_or_none()
        
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User with this email already exists"
            )

        # Hash password
        password_hash = hashlib.sha256(password.encode()).hexdigest()

        # Create user
        user = User(
            id=secrets.token_urlsafe(32),
            email=email,
            name=name or email.split("@")[0],
            provider="email",
            password_hash=password_hash,
            is_active=True,
        )
        self.db.add(user)
        await self.db.flush()

        # Create session
        session_data = await self._create_session(user.id)

        return {
            "user": user.to_dict(),
            **session_data
        }

    async def login_email(self, email: str, password: str) -> dict:
        """Login with email/password."""
        # Find user
        result = await self.db.execute(
            select(User).where(User.email == email, User.provider == "email")
        )
        user = result.scalar_one_or_none()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password"
            )

        # Verify password
        password_hash = hashlib.sha256(password.encode()).hexdigest()
        if user.password_hash != password_hash:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password"
            )

        # Update last login
        user.last_login = datetime.utcnow()
        await self.db.flush()

        # Create session
        session_data = await self._create_session(user.id)

        return {
            "user": user.to_dict(),
            **session_data
        }

    # ============================================
    # Google OAuth
    # ============================================

    def get_google_auth_url(self) -> str:
        """Get Google OAuth authorization URL."""
        state = secrets.token_urlsafe(32)
        params = {
            "client_id": GOOGLE_CLIENT_ID,
            "redirect_uri": GOOGLE_REDIRECT_URI,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "access_type": "offline",
            "prompt": "consent",
        }
        query = "&".join(f"{k}={v}" for k, v in params.items())
        return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"

    async def login_google(self, code: str) -> dict:
        """Login with Google OAuth code."""
        # Exchange code for tokens
        token_data = await self._exchange_google_code(code)
        
        # Get user info from Google
        user_info = await self._get_google_user_info(token_data["access_token"])

        # Find or create user
        result = await self.db.execute(
            select(User).where(User.provider == "google", User.provider_id == user_info["sub"])
        )
        user = result.scalar_one_or_none()

        if not user:
            # Check if email already exists
            result = await self.db.execute(
                select(User).where(User.email == user_info["email"])
            )
            existing_user = result.scalar_one_or_none()

            if existing_user:
                # Link Google to existing account
                existing_user.provider = "google"
                existing_user.provider_id = user_info["sub"]
                existing_user.avatar_url = user_info.get("picture")
                existing_user.last_login = datetime.utcnow()
                user = existing_user
            else:
                # Create new user
                user = User(
                    id=secrets.token_urlsafe(32),
                    email=user_info["email"],
                    name=user_info.get("name", user_info["email"].split("@")[0]),
                    avatar_url=user_info.get("picture"),
                    provider="google",
                    provider_id=user_info["sub"],
                    is_active=True,
                    last_login=datetime.utcnow(),
                )
                self.db.add(user)

        # Save OAuth tokens
        await self._save_oauth_token(
            user_id=user.id,
            provider="google",
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            expires_at=datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 3600))
        )

        await self.db.flush()

        # Create session
        session_data = await self._create_session(user.id)

        return {
            "user": user.to_dict(),
            **session_data
        }

    async def _exchange_google_code(self, code: str) -> dict:
        """Exchange Google OAuth code for tokens."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": GOOGLE_CLIENT_ID,
                    "client_secret": GOOGLE_CLIENT_SECRET,
                    "redirect_uri": GOOGLE_REDIRECT_URI,
                    "grant_type": "authorization_code",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if response.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Failed to exchange Google OAuth code"
                )
            return response.json()

    async def _get_google_user_info(self, access_token: str) -> dict:
        """Get user info from Google."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if response.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Failed to get Google user info"
                )
            return response.json()

    # ============================================
    # GitHub OAuth
    # ============================================

    def get_github_auth_url(self) -> str:
        """Get GitHub OAuth authorization URL."""
        state = secrets.token_urlsafe(32)
        params = {
            "client_id": GITHUB_CLIENT_ID,
            "redirect_uri": GITHUB_REDIRECT_URI,
            "scope": "user:email",
            "state": state,
        }
        query = "&".join(f"{k}={v}" for k, v in params.items())
        return f"https://github.com/login/oauth/authorize?{query}"

    async def login_github(self, code: str) -> dict:
        """Login with GitHub OAuth code."""
        # Exchange code for tokens
        token_data = await self._exchange_github_code(code)
        
        # Get user info from GitHub
        user_info = await self._get_github_user_info(token_data["access_token"])

        # Find or create user
        result = await self.db.execute(
            select(User).where(User.provider == "github", User.provider_id == str(user_info["id"]))
        )
        user = result.scalar_one_or_none()

        if not user:
            # Check if email already exists
            email = user_info.get("email") or f"{user_info['id']}@github.users.noreply.github.com"
            result = await self.db.execute(
                select(User).where(User.email == email)
            )
            existing_user = result.scalar_one_or_none()

            if existing_user:
                # Link GitHub to existing account
                existing_user.provider = "github"
                existing_user.provider_id = str(user_info["id"])
                existing_user.avatar_url = user_info.get("avatar_url")
                existing_user.last_login = datetime.utcnow()
                user = existing_user
            else:
                # Create new user
                user = User(
                    id=secrets.token_urlsafe(32),
                    email=email,
                    name=user_info.get("name") or user_info.get("login"),
                    avatar_url=user_info.get("avatar_url"),
                    provider="github",
                    provider_id=str(user_info["id"]),
                    is_active=True,
                    last_login=datetime.utcnow(),
                )
                self.db.add(user)

        # Save OAuth tokens
        await self._save_oauth_token(
            user_id=user.id,
            provider="github",
            access_token=token_data["access_token"],
            refresh_token=None,
            expires_at=datetime.utcnow() + timedelta(days=365)
        )

        await self.db.flush()

        # Create session
        session_data = await self._create_session(user.id)

        return {
            "user": user.to_dict(),
            **session_data
        }

    async def _exchange_github_code(self, code: str) -> dict:
        """Exchange GitHub OAuth code for tokens."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://github.com/login/oauth/access_token",
                data={
                    "code": code,
                    "client_id": GITHUB_CLIENT_ID,
                    "client_secret": GITHUB_CLIENT_SECRET,
                    "redirect_uri": GITHUB_REDIRECT_URI,
                },
                headers={"Accept": "application/json"},
            )
            if response.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Failed to exchange GitHub OAuth code"
                )
            return response.json()

    async def _get_github_user_info(self, access_token: str) -> dict:
        """Get user info from GitHub."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.github.com/user",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                },
            )
            if response.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Failed to get GitHub user info"
                )
            return response.json()

    # ============================================
    # Session Management
    # ============================================

    async def _create_session(self, user_id: str) -> dict:
        """Create a new session for a user."""
        token = secrets.token_urlsafe(64)
        token_hash = hashlib.sha256(token.encode()).hexdigest()

        session = SessionModel(
            id=secrets.token_urlsafe(32),
            user_id=user_id,
            token_hash=token_hash,
            expires_at=datetime.utcnow() + timedelta(days=SESSION_DURATION_DAYS),
            is_active=True,
        )
        self.db.add(session)
        await self.db.flush()

        return {
            "tokens": {
                "access_token": token,
                "token_type": "bearer",
                "expires_in": SESSION_DURATION_DAYS * 24 * 3600,
            }
        }

    async def _save_oauth_token(
        self,
        user_id: str,
        provider: str,
        access_token: str,
        refresh_token: Optional[str],
        expires_at: datetime,
    ):
        """Save OAuth token to database."""
        # Remove any existing tokens for this provider
        result = await self.db.execute(
            select(OAuthToken).where(
                OAuthToken.user_id == user_id,
                OAuthToken.provider == provider
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            await self.db.delete(existing)

        # Save new token
        oauth_token = OAuthToken(
            user_id=user_id,
            provider=provider,
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=expires_at,
        )
        self.db.add(oauth_token)

    async def get_current_user(self, authorization: str) -> User:
        """Get current user from authorization header."""
        if not authorization.startswith("Bearer "):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authorization header"
            )

        token = authorization.replace("Bearer ", "")
        token_hash = hashlib.sha256(token.encode()).hexdigest()

        # Find session
        result = await self.db.execute(
            select(SessionModel).where(
                SessionModel.token_hash == token_hash,
                SessionModel.expires_at > datetime.utcnow(),
                SessionModel.is_active == True
            )
        )
        session = result.scalar_one_or_none()

        if not session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token"
            )

        # Get user
        result = await self.db.execute(
            select(User).where(User.id == session.user_id)
        )
        user = result.scalar_one_or_none()

        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive"
            )

        return user

    async def logout(self, authorization: str) -> None:
        """Logout and invalidate session."""
        if not authorization.startswith("Bearer "):
            return

        token = authorization.replace("Bearer ", "")
        token_hash = hashlib.sha256(token.encode()).hexdigest()

        # Delete session
        result = await self.db.execute(
            select(SessionModel).where(SessionModel.token_hash == token_hash)
        )
        session = result.scalar_one_or_none()

        if session:
            await self.db.delete(session)
            await self.db.flush()
