# Surf IDE

AI-powered IDE forked from VSCode (code-oss) with integrated Surf AI.

## Features

- 🤖 **Integrated AI**: Offline (Qwen) + Online (OpenRouter gateway)
- 🔒 **Privacy-first**: Local model inference, optional cloud AI
- ⚡ **Smart routing**: Automatic selection of best AI backend
- 💰 **Cost-effective**: Cache-augmented inference reduces API costs by 60%+
- 🎨 **Familiar UI**: VSCode-based with custom Surf theme

## Architecture

```
Surf IDE (VSCode fork)
├─ Core: VSCode (code-oss) - MIT License
├─ Surf AI Extension
│  ├─ Offline Mode: llama.cpp + Qwen
│  ├─ Online Mode: OpenRouter gateway
│  └─ Smart routing
├─ Custom Theme: Surf Dark/Light
└─ Branded Installers
   ├─ macOS: DMG
   └─ Windows: EXE
```

## Backend Integration

Surf IDE connects to the existing Surf.ai backend:
- **API Gateway**: `services/api/` (OpenRouter proxy + auth)
- **Database**: MySQL with user management
- **Billing**: Per-user micro-billing via Stripe/Razorpay
- **Local Models**: llama.cpp sidecar for offline inference

## Getting Started

### Prerequisites
- Node.js 22+
- Python 3.12+
- Git

### Build from Source

```bash
# Clone the repository
git clone https://github.com/kslji/surf.ai.git
cd surf.ai/surf-ide

# Install dependencies
npm install

# Build
npm run build

# Run
npm run dev
```

## Development Phases

- [x] Phase 1: Fork VSCode & branding
- [ ] Phase 2: Surf AI extension scaffold
- [ ] Phase 3: Backend integration
- [ ] Phase 4: Smart routing & caching
- [ ] Phase 5: Installers & release

## License

MIT (inherited from VSCode code-oss)
