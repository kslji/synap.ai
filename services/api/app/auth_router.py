"""Authentication API endpoints."""
from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from .database import get_db
from .auth_service import AuthService


router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


# ============================================
# Request/Response Models
# ============================================

class EmailLoginRequest(BaseModel):
    """Email login request."""
    email: EmailStr
    password: str = Field(..., min_length=8)


class EmailRegisterRequest(BaseModel):
    """Email registration request."""
    email: EmailStr
    password: str = Field(..., min_length=8)
    name: Optional[str] = None


class OAuthCallbackRequest(BaseModel):
    """OAuth callback request."""
    code: str


class AuthResponse(BaseModel):
    """Authentication response."""
    user: dict
    tokens: dict


class MessageResponse(BaseModel):
    """Simple message response."""
    message: str


# ============================================
# Email/Password Endpoints
# ============================================

@router.post("/register", response_model=AuthResponse)
async def register(request: EmailRegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a new user with email/password."""
    auth_service = AuthService(db)
    return await auth_service.register_email(
        email=request.email,
        password=request.password,
        name=request.name
    )


@router.post("/login", response_model=AuthResponse)
async def login(request: EmailLoginRequest, db: AsyncSession = Depends(get_db)):
    """Login with email/password."""
    auth_service = AuthService(db)
    return await auth_service.login_email(
        email=request.email,
        password=request.password
    )


# ============================================
# Google OAuth Endpoints
# ============================================

@router.get("/google")
async def google_auth():
    """Get Google OAuth authorization URL."""
    auth_service = AuthService(None)  # No DB needed for URL generation
    auth_url = auth_service.get_google_auth_url()
    return {"auth_url": auth_url}


@router.post("/google/callback", response_model=AuthResponse)
async def google_callback(request: OAuthCallbackRequest, db: AsyncSession = Depends(get_db)):
    """Handle Google OAuth callback."""
    auth_service = AuthService(db)
    return await auth_service.login_google(code=request.code)


# ============================================
# GitHub OAuth Endpoints
# ============================================

@router.get("/github")
async def github_auth():
    """Get GitHub OAuth authorization URL."""
    auth_service = AuthService(None)  # No DB needed for URL generation
    auth_url = auth_service.get_github_auth_url()
    return {"auth_url": auth_url}


@router.post("/github/callback", response_model=AuthResponse)
async def github_callback(request: OAuthCallbackRequest, db: AsyncSession = Depends(get_db)):
    """Handle GitHub OAuth callback."""
    auth_service = AuthService(db)
    return await auth_service.login_github(code=request.code)


# ============================================
# User Profile Endpoints
# ============================================

@router.get("/me", response_model=dict)
async def get_current_user(
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db)
):
    """Get current user profile."""
    auth_service = AuthService(db)
    user = await auth_service.get_current_user(authorization)
    return {"user": user.to_dict()}


# ============================================
# Logout Endpoint
# ============================================

@router.post("/logout", response_model=MessageResponse)
async def logout(
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db)
):
    """Logout and invalidate session."""
    auth_service = AuthService(db)
    await auth_service.logout(authorization)
    return {"message": "Logged out successfully"}
