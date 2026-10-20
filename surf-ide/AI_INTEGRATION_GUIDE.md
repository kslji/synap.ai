# Surf AI Extension - Context Extraction & AI Integration

## How It Works

### 1. Context Extraction (What Cursor/Qoder Do)

When you ask a question in the chat, the extension extracts:

```typescript
interface IDEContext {
  // Current file
  currentFile: {
    path: string;
    language: string;
    content: string;
    selection: string;  // Selected text
    cursor: { line: number; column: number };
  };
  
  // Open files (tabs)
  openFiles: Array<{
    path: string;
    content: string;
    isActive: boolean;
  }>;
  
  // Project structure
  project: {
    rootPath: string;
    files: string[];  // File tree
    gitStatus: string;  // Changed files
  };
  
  // Symbols (functions, classes, variables)
  symbols: Array<{
    name: string;
    kind: string;  // function, class, variable
    location: string;
    signature: string;
  }>;
  
  // Errors & diagnostics
  diagnostics: Array<{
    file: string;
    line: number;
    message: string;
    severity: string;
  }>;
  
  // Terminal output (optional)
  terminal?: {
    lastCommand: string;
    output: string;
  };
}
```

### 2. Prompt Construction

The extension builds a prompt with context:

```typescript
function buildPrompt(userQuestion: string, context: IDEContext): string {
  return `
You are an AI coding assistant integrated into Surf IDE.
You have access to the user's codebase and can provide contextual help.

## Current Context

### Active File: ${context.currentFile.path}
Language: ${context.currentFile.language}

\`\`\`${context.currentFile.language}
${context.currentFile.content}
\`\`\`

${context.currentFile.selection ? `
### Selected Text:
\`\`\`
${context.currentFile.selection}
\`\`\`
` : ''}

### Open Files:
${context.openFiles.map(f => `- ${f.path}`).join('\n')}

### Project Structure:
${context.project.files.slice(0, 20).join('\n')}

### Relevant Symbols:
${context.symbols.map(s => `- ${s.kind} ${s.name} at ${s.location}`).join('\n')}

### Current Errors:
${context.diagnostics.map(d => `- ${d.file}:${d.line} ${d.message}`).join('\n')}

## User Question
${userQuestion}

## Instructions
- Use the context above to provide accurate, relevant answers
- Reference specific files, functions, or line numbers when applicable
- Suggest code changes with proper syntax highlighting
- If you need more context, ask clarifying questions
`;
}
```

### 3. AI Integration

```typescript
async function sendToAI(prompt: string, mode: 'offline' | 'online'): Promise<string> {
  if (mode === 'online') {
    // Use OpenRouter gateway
    const response = await fetch('http://localhost:8000/api/v1/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getAuthToken()}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 2000
      })
    });
    const data = await response.json();
    return data.choices[0].message.content;
  } else {
    // Use local Qwen model
    const response = await fetch('http://localhost:8080/completion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        n_predict: 2000,
        temperature: 0.7
      })
    });
    const data = await response.json();
    return data.content;
  }
}
```

### 4. Inline Code Completions

```typescript
// Provide ghost text suggestions as user types
vscode.languages.registerInlineCompletionItemProvider('*', {
  async provideInlineCompletionItems(document, position) {
    const prefix = document.getText(new vscode.Range(
      new vscode.Position(0, 0),
      position
    ));
    const suffix = document.getText(new vscode.Range(
      position,
      document.lineAt(document.lineCount - 1).range.end
    ));
    
    const prompt = `Complete this code:
${prefix}
// CURSOR HERE
${suffix}
`;
    
    const completion = await sendToAI(prompt, 'offline');
    
    return [{
      insertText: completion,
      range: new vscode.Range(position, position)
    }];
  }
});
```

## Implementation Plan

### Phase 1: Basic Context Extraction (Week 1)
- [ ] Extract current file content
- [ ] Extract selected text
- [ ] Extract open files
- [ ] Build basic prompt

### Phase 2: Advanced Context (Week 2)
- [ ] Extract project structure
- [ ] Extract symbols (using LSP)
- [ ] Extract diagnostics (errors)
- [ ] Extract git status

### Phase 3: AI Integration (Week 2-3)
- [ ] Connect to OpenRouter gateway
- [ ] Connect to local llama.cpp
- [ ] Implement smart routing
- [ ] Add streaming responses

### Phase 4: Inline Completions (Week 3)
- [ ] Implement ghost text
- [ ] Add debouncing
- [ ] Optimize for performance
- [ ] Add accept/reject actions

### Phase 5: Code Actions (Week 4)
- [ ] Quick fixes
- [ ] Refactoring suggestions
- [ ] Test generation
- [ ] Documentation generation
