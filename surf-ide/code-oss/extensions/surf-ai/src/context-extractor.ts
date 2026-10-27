/**
 * Surf AI Extension - Context Extraction
 * 
 * This module extracts context from the IDE to provide to AI models.
 * Similar to how Cursor, Qoder, and GitHub Copilot work.
 */

import * as vscode from 'vscode';
import * as path from 'path';

export interface IDEContext {
  currentFile: CurrentFileContext | null;
  openFiles: OpenFileContext[];
  project: ProjectContext | null;
  symbols: SymbolContext[];
  diagnostics: DiagnosticContext[];
  gitStatus: GitContext | null;
}

export interface CurrentFileContext {
  path: string;
  language: string;
  content: string;
  selection: string;
  cursor: { line: number; column: number };
  lineCount: number;
}

export interface OpenFileContext {
  path: string;
  language: string;
  content: string;
  isActive: boolean;
  isDirty: boolean;
}

export interface ProjectContext {
  rootPath: string;
  files: string[];
  totalFiles: number;
}

export interface SymbolContext {
  name: string;
  kind: string;
  location: string;
  range: vscode.Range;
  containerName: string;
}

export interface DiagnosticContext {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: string;
  source: string;
}

export interface GitContext {
  branch: string;
  changedFiles: string[];
  stagedFiles: string[];
  untrackedFiles: string[];
}

/**
 * Extract complete IDE context
 */
export async function extractContext(): Promise<IDEContext> {
  const [currentFile, openFiles, project, symbols, diagnostics, gitStatus] = await Promise.all([
    getCurrentFileContext(),
    getOpenFilesContext(),
    getProjectContext(),
    getSymbolsContext(),
    getDiagnosticsContext(),
    getGitContext()
  ]);

  return {
    currentFile,
    openFiles,
    project,
    symbols,
    diagnostics,
    gitStatus
  };
}

/**
 * Get current file context
 */
async function getCurrentFileContext(): Promise<CurrentFileContext | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;

  const document = editor.document;
  const selection = editor.selection;
  const selectedText = document.getText(selection);

  return {
    path: document.uri.fsPath,
    language: document.languageId,
    content: document.getText(),
    selection: selectedText,
    cursor: {
      line: selection.active.line,
      column: selection.active.character
    },
    lineCount: document.lineCount
  };
}

/**
 * Get context for all open files
 */
async function getOpenFilesContext(): Promise<OpenFileContext[]> {
  const openFiles: OpenFileContext[] = [];

  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        const uri = tab.input.uri;
        try {
          const document = await vscode.workspace.openTextDocument(uri);
          openFiles.push({
            path: uri.fsPath,
            language: document.languageId,
            content: document.getText(),
            isActive: tab.isActive,
            isDirty: document.isDirty
          });
        } catch (error) {
          // Skip files that can't be opened
        }
      }
    }
  }

  return openFiles;
}

/**
 * Get project structure context
 */
async function getProjectContext(): Promise<ProjectContext | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return null;

  const rootPath = workspaceFolders[0].uri.fsPath;
  
  // Get file tree (limited to first 100 files for performance)
  const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 100);
  
  return {
    rootPath,
    files: files.map((f: vscode.Uri) => path.relative(rootPath, f.fsPath)),
    totalFiles: files.length
  };
}

/**
 * Get symbols (functions, classes, variables) from current file
 */
async function getSymbolsContext(): Promise<SymbolContext[]> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return [];

  const docUri = editor.document.uri;
  const docPath = docUri.fsPath;

  try {
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      docUri
    );

    if (!symbols) return [];

    const symbolContexts: SymbolContext[] = [];
    
    function flattenSymbols(syms: vscode.DocumentSymbol[], container: string = '') {
      for (const sym of syms) {
        symbolContexts.push({
          name: sym.name,
          kind: vscode.SymbolKind[sym.kind],
          location: `${docPath}:${sym.range.start.line + 1}`,
          range: sym.range,
          containerName: container || sym.name
        });
        
        if (sym.children && sym.children.length > 0) {
          flattenSymbols(sym.children, sym.name);
        }
      }
    }

    flattenSymbols(symbols);
    return symbolContexts;
  } catch (error) {
    return [];
  }
}

/**
 * Get diagnostics (errors, warnings) from workspace
 */
async function getDiagnosticsContext(): Promise<DiagnosticContext[]> {
  const diagnostics: DiagnosticContext[] = [];

  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    for (const diag of diags) {
      diagnostics.push({
        file: uri.fsPath,
        line: diag.range.start.line + 1,
        column: diag.range.start.character + 1,
        message: diag.message,
        severity: vscode.DiagnosticSeverity[diag.severity],
        source: diag.source || 'unknown'
      });
    }
  }

  return diagnostics.slice(0, 50); // Limit to first 50 for performance
}

/**
 * Get git status context
 */
async function getGitContext(): Promise<GitContext | null> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return null;

    const rootPath = workspaceFolders[0].uri.fsPath;
    
    // Get git branch
    const branch = await executeCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], rootPath);
    
    // Get changed files
    const statusOutput = await executeCommand('git', ['status', '--porcelain'], rootPath);
    const lines = statusOutput.split('\n').filter(line => line.trim());
    
    const changedFiles: string[] = [];
    const stagedFiles: string[] = [];
    const untrackedFiles: string[] = [];

    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3);
      
      if (status === '??') {
        untrackedFiles.push(file);
      } else if (status.startsWith('M') || status.startsWith('A')) {
        if (status[0] !== ' ') {
          stagedFiles.push(file);
        }
        if (status[1] !== ' ') {
          changedFiles.push(file);
        }
      }
    }

    return {
      branch: branch.trim(),
      changedFiles,
      stagedFiles,
      untrackedFiles
    };
  } catch (error) {
    return null;
  }
}

/**
 * Execute a command and return output
 */
async function executeCommand(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const proc = spawn(command, args, { cwd });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code: number) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr));
      }
    });
  });
}

/**
 * Build a prompt with context
 */
export function buildPromptWithContext(userQuestion: string, context: IDEContext): string {
  let prompt = `You are an AI coding assistant integrated into Surf IDE.
You have access to the user's codebase and can provide contextual help.

## Current Context
`;

  // Add current file
  if (context.currentFile) {
    prompt += `
### Active File: ${context.currentFile.path}
Language: ${context.currentFile.language}
Lines: ${context.currentFile.lineCount}

\`\`\`${context.currentFile.language}
${context.currentFile.content}
\`\`\`
`;

    if (context.currentFile.selection) {
      prompt += `
### Selected Text (lines ${context.currentFile.cursor.line + 1}):
\`\`\`
${context.currentFile.selection}
\`\`\`
`;
    }
  }

  // Add open files
  if (context.openFiles.length > 0) {
    prompt += `
### Open Files:
${context.openFiles.map(f => `- ${f.path}${f.isDirty ? ' (modified)' : ''}${f.isActive ? ' (active)' : ''}`).join('\n')}
`;
  }

  // Add project structure
  if (context.project) {
    prompt += `
### Project: ${context.project.rootPath}
Total files: ${context.project.totalFiles}

File tree (first 20):
${context.project.files.slice(0, 20).map(f => `- ${f}`).join('\n')}
`;
  }

  // Add symbols
  if (context.symbols.length > 0) {
    prompt += `
### Symbols in Current File:
${context.symbols.slice(0, 20).map(s => `- ${s.kind} \`${s.name}\` at line ${s.range.start.line + 1}`).join('\n')}
`;
  }

  // Add diagnostics
  if (context.diagnostics.length > 0) {
    prompt += `
### Current Errors/Warnings:
${context.diagnostics.slice(0, 10).map(d => `- ${d.file}:${d.line} [${d.severity}] ${d.message}`).join('\n')}
`;
  }

  // Add git status
  if (context.gitStatus) {
    prompt += `
### Git Status:
Branch: ${context.gitStatus.branch}
${context.gitStatus.changedFiles.length > 0 ? `Changed: ${context.gitStatus.changedFiles.join(', ')}` : ''}
${context.gitStatus.stagedFiles.length > 0 ? `Staged: ${context.gitStatus.stagedFiles.join(', ')}` : ''}
${context.gitStatus.untrackedFiles.length > 0 ? `Untracked: ${context.gitStatus.untrackedFiles.join(', ')}` : ''}
`;
  }

  // Add user question
  prompt += `
## User Question
${userQuestion}

## Instructions
- Use the context above to provide accurate, relevant answers
- Reference specific files, functions, or line numbers when applicable
- Suggest code changes with proper syntax highlighting
- If you need more context, ask clarifying questions
- Be concise but thorough
`;

  return prompt;
}
