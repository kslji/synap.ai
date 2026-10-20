# ADR 0006: Surf IDE - VSCode Fork with Integrated AI

## Status
Accepted

## Context

### Current State
- Building custom Electron desktop app with hand-coded editor UI
- Custom chat interface with mascot ("pip" character)
- Local AI via llama.cpp + Qwen models
- Moving to OpenRouter gateway for cloud AI
- Significant engineering effort to match VSCode features

### Problem
- Building a production-ready IDE from scratch takes years
- Missing language support, extensions, and ecosystem
- Developers expect VSCode-like experience
- Hard to compete with existing solutions
- Reinventing the wheel instead of focusing on AI differentiator

### Solution
Fork VSCode (code-oss) and create "Surf IDE" with:
- Custom branding and theme
- Integrated Surf AI extension (offline + online)
- Branded installers (DMG/EXE)
- No mascot character
- Focus on AI features as differentiator

## Decision

### Architecture
```
Surf IDE (VSCode fork)
├─ Core: VSCode (code-oss) - MIT License
├─ Surf AI Extension
│  ├─ Offline Mode: llama.cpp + Qwen
│  ├─ Online Mode: OpenRouter gateway
│  └─ Smart routing
├─ Custom Theme: Surf Dark/Light
├─ Custom UI Components
│  ├─ Chat sidebar
│  ├─ Inline completions
│  └─ Billing dashboard
└─ Branded Installers
   ├─ macOS: DMG with custom artwork
   └─ Windows: EXE with custom wizard
```

### Key Components

#### 1. VSCode Fork
- Fork `microsoft/vscode` (code-oss)
- Remove Microsoft branding
- Add Surf branding
- Maintain upstream sync capability

#### 2. Surf AI Extension
- TypeScript extension in `extensions/surf-ai/`
- Connects to local llama.cpp server
- Connects to OpenRouter gateway
- Provides chat sidebar, inline completions, code generation
- Handles billing and usage tracking

#### 3. Smart Routing
```typescript
async function routeQuery(query: string, context: Context) {
  if (isOffline() || isPrivacyMode()) {
    return useLocalQwen(query);
  } else if (hasBalance() && isComplexTask(query)) {
    return useOpenRouter(query);
  } else {
    return useLocalQwen(query);
  }
}
```

#### 4. Custom Theme
- Surf Dark (default)
- Surf Light
- Custom colors, icons, fonts
- No mascot character

#### 5. Branded Installers
- macOS: Custom DMG with Surf artwork
- Windows: Custom EXE with branded wizard
- Linux: AppImage/DEB/RPM

## Implementation Phases

### Phase 1: Fork VSCode (Week 1-2)
1. Clone VSCode repository
2. Remove Microsoft branding
3. Add Surf branding (logo, name, colors)
4. Set up build pipeline
5. Verify builds on Mac/Win/Linux

**Deliverables:**
- Working VSCode fork with Surf branding
- Build scripts for all platforms
- CI/CD pipeline

### Phase 2: Surf AI Extension (Week 3-4)
1. Create extension scaffold
2. Implement offline mode (llama.cpp integration)
3. Implement online mode (OpenRouter API)
4. Build chat sidebar UI
5. Add inline completions
6. Implement smart routing

**Deliverables:**
- Working Surf AI extension
- Chat sidebar with offline/online modes
- Inline code completions
- Smart routing logic

### Phase 3: Custom UI (Week 5)
1. Design and implement Surf theme
2. Custom welcome page
3. Custom settings UI
4. Remove mascot character
5. Polish UI/UX

**Deliverables:**
- Surf Dark/Light themes
- Custom welcome page
- Branded settings UI
- No mascot

### Phase 4: Installers (Week 6)
1. Design DMG artwork (macOS)
2. Design EXE wizard (Windows)
3. Configure electron-builder
4. Test installation on all platforms
5. Code signing setup

**Deliverables:**
- Branded DMG installer
- Branded EXE installer
- Code-signed packages
- Installation documentation

### Phase 5: Integration & Testing (Week 7-8)
1. Integrate with existing backend (OpenRouter gateway)
2. Test offline mode with Qwen models
3. Test online mode with billing
4. Performance optimization
5. Bug fixes and polish

**Deliverables:**
- Fully integrated Surf IDE
- Tested on Mac/Win/Linux
- Performance benchmarks
- Release candidate

## Technical Details

### VSCode Fork Management
```bash
# Initial fork
git clone https://github.com/microsoft/vscode.git surf-ide
cd surf-ide
git remote add upstream https://github.com/microsoft/vscode.git

# Sync with upstream (quarterly)
git fetch upstream
git merge upstream/main
# Resolve conflicts
# Test build
# Push to our repo
```

### Extension Structure
```
extensions/surf-ai/
├─ src/
│  ├─ extension.ts          # Main entry
│  ├─ offline-mode.ts       # llama.cpp integration
│  ├─ online-mode.ts        # OpenRouter API
│  ├─ router.ts             # Smart routing
│  ├─ chat-sidebar.ts       # Chat UI
│  ├─ inline-completions.ts # Code completions
│  ├─ billing.ts            # Usage tracking
│  └─ settings.ts           # Configuration
├─ media/                    # Icons, images
├─ package.json
└─ README.md
```

### Build Configuration
```json
// product.json
{
  "nameShort": "Surf IDE",
  "nameLong": "Surf IDE - AI-Powered Development",
  "applicationName": "surf-ide",
  "dataFolderName": ".surf-ide",
  "win32AppId": "{{...}}",
  "darwinBundleIdentifier": "ai.surf.ide",
  "reportIssueUrl": "https://github.com/kslji/surf.ai/issues",
  "extensionsGallery": {
    "serviceUrl": "https://marketplace.visualstudio.com/_apis/public/gallery"
  }
}
```

### Installer Configuration
```javascript
// electron-builder.config.js
module.exports = {
  appId: "ai.surf.ide",
  productName: "Surf IDE",
  directories: {
    output: "dist"
  },
  mac: {
    category: "public.app-category.developer-tools",
    icon: "resources/icon.icns",
    darkModeSupport: true,
    artifactName: "${productName}-${version}-mac.${ext}",
    target: ["dmg"]
  },
  win: {
    icon: "resources/icon.ico",
    artifactName: "${productName}-${version}-win.${ext}",
    target: ["nsis"]
  },
  linux: {
    icon: "resources/icon.png",
    category: "Development",
    target: ["AppImage", "deb", "rpm"]
  }
};
```

## Migration Strategy

### From Current App to Surf IDE

**Phase 1: Parallel Development (Week 1-4)**
- Continue current app development
- Start VSCode fork in parallel
- No disruption to existing users

**Phase 2: Feature Parity (Week 5-6)**
- Port key features from current app
- Chat interface → Surf AI extension
- Local model management → Extension offline mode
- Settings migration

**Phase 3: Beta Testing (Week 7-8)**
- Release Surf IDE beta
- Collect feedback
- Fix issues

**Phase 4: Launch (Week 9)**
- Release Surf IDE v1.0
- Deprecate old app
- Provide migration guide

## Benefits

### For Users
1. ✅ Familiar VSCode interface
2. ✅ All language support built-in
3. ✅ 40K+ extensions available
4. ✅ Integrated AI (offline + online)
5. ✅ Professional IDE experience

### For Development Team
1. ✅ Focus on AI features (differentiator)
2. ✅ Don't reinvent the wheel
3. ✅ Leverage VSCode's massive ecosystem
4. ✅ Faster time to market
5. ✅ Easier to maintain

### For Business
1. ✅ Competitive with Cursor, GitHub Codespaces
2. ✅ Clear value proposition
3. ✅ Monetization via AI billing
4. ✅ Scalable architecture
5. ✅ Professional product

## Risks & Mitigations

### Risk 1: VSCode Fork Maintenance
**Risk:** Keeping fork in sync with upstream is complex  
**Mitigation:** Quarterly sync, automated testing, dedicated maintainer

### Risk 2: Extension Complexity
**Risk:** Building full-featured AI extension is hard  
**Mitigation:** Start with MVP, iterate based on feedback

### Risk 3: Migration Disruption
**Risk:** Existing users disrupted by transition  
**Mitigation:** Parallel development, gradual migration, clear communication

### Risk 4: Performance
**Risk:** VSCode + AI extension might be slow  
**Mitigation:** Performance testing, optimization, lazy loading

## Success Metrics

### Technical
- Build succeeds on all platforms
- Extension loads in < 2 seconds
- Chat response time < 1 second (local), < 3 seconds (cloud)
- Memory usage < 500MB idle, < 2GB under load

### User Experience
- Installation success rate > 99%
- Crash rate < 0.1%
- User satisfaction > 4.5/5
- Extension adoption > 80%

### Business
- Time to market: 8 weeks
- Development cost: < 200 engineering hours
- User growth: 1000 users in first month
- Revenue: $10K MRR in first 3 months

## Alternatives Considered

### Alternative 1: Continue Custom IDE
**Pros:** Full control, no upstream dependency  
**Cons:** Years of development, missing features, hard to compete  
**Decision:** Rejected - too slow, too expensive

### Alternative 2: VSCode Extension Only
**Pros:** Easiest to build, quick to market  
**Cons:** Less control, competing with other extensions, hard to differentiate  
**Decision:** Rejected - less impactful, harder to monetize

### Alternative 3: Theia IDE
**Pros:** More flexible, designed for embedding  
**Cons:** Smaller ecosystem, less familiar to developers  
**Decision:** Rejected - VSCode has better ecosystem and UX

## Conclusion

Forking VSCode to create Surf IDE is the right decision because:
1. ✅ Fastest path to market (8 weeks vs 2+ years)
2. ✅ Best user experience (familiar VSCode + AI)
3. ✅ Clear differentiator (offline + online AI)
4. ✅ Competitive with Cursor, GitHub Codespaces
5. ✅ Scalable and maintainable
6. ✅ Professional product

This positions Surf.ai as a serious player in the AI-powered IDE space.

## Next Steps

1. ✅ Create `feature/surf-ide` branch
2. ⏳ Fork VSCode repository
3. ⏳ Set up build pipeline
4. ⏳ Create Surf AI extension scaffold
5. ⏳ Begin Phase 1 implementation

## References

- [VSCode Documentation](https://code.visualstudio.com/api)
- [VSCode Extension API](https://code.visualstudio.com/api/references/vscode-api)
- [Cursor Case Study](https://cursor.com/blog)
- [VSCode Fork Examples](https://github.com/microsoft/vscode/wiki/Forking)
