#!/usr/bin/env node
/**
 * Applies the Surf IDE changes to a fresh VS Code checkout in `code-oss/`.
 *
 * The fork itself is upstream material and is git-ignored by this repository;
 * only `code-oss/extensions/surf-ai/` is ours. That means the changes the Surf
 * shell needs have to be re-applied on every new checkout, so they live here
 * instead of in somebody's working tree:
 *
 *   1. product.json branding, the Open VSX gallery, and `defaultChatAgent`.
 *      The workbench reads `product.defaultChatAgent` at module scope in the
 *      chat and onboarding contributions; without it those imports throw and
 *      the Electron window is never shown.
 *   2. product.json Copilot strip-out, so no shipped path points at a
 *      Microsoft or GitHub endpoint from a product that advertises no egress.
 *   3. A guard in the extension enablement service. Upstream retires the
 *      completions extension when "extension unification" runs and disables
 *      the chat extension on profiles that have not finished chat setup. Both
 *      rules key off `defaultChatAgent`, and Surf ships one extension for both
 *      roles, so without the guard Surf's own built-in extension is disabled.
 *   4. `chat.disableAIFeatures` defaulted to on, so VS Code's own Chat view
 *      never appears beside Surf AI in the right bar. Two guards come with it:
 *      the chat setup listener must not write that default back off, and the
 *      AI-features toggle must not enable or disable the built-in extension it
 *      now points at, which is Surf's own assistant.
 *
 * Run from anywhere: `node surf-ide/fork-setup.mjs`. Set `SURF_FORK_DIR` to
 * point at a checkout somewhere other than `surf-ide/code-oss`. Safe to re-run.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORK = process.env.SURF_FORK_DIR
	? resolve(process.env.SURF_FORK_DIR)
	: resolve(dirname(fileURLToPath(import.meta.url)), 'code-oss');

/** Surf identity plus the gallery we can actually ship against. */
const BRANDING = {
	nameShort: 'Surf IDE',
	nameLong: 'Surf IDE',
	applicationName: 'surf-ide',
	dataFolderName: '.surf-ide',
	win32DirName: 'Surf IDE',
	win32NameVersion: 'Surf IDE',
	win32RegValueName: 'SurfIDE',
	win32AppUserModelId: 'Surf.IDE',
	win32ShellNameShort: 'Surf IDE',
	darwinBundleIdentifier: 'ai.surf.ide',
	linuxDesktopName: 'ai.surf.IDE',
	linuxIconName: 'surf-ide',
	urlProtocol: 'surf-ide',
	sharedDataFolderName: '.surf-ide-shared',
	extensionsGallery: {
		serviceUrl: 'https://open-vsx.org/vscode/gallery',
		itemUrl: 'https://open-vsx.org/vscode/item',
		resourceUrlTemplate: 'https://open-vsx.org/vscode/resource/{publisher}/{name}/{version}/{path}',
		controlUrl: 'https://open-vsx.org/vscode/extensions-control.json',
		latestUrlTemplate: 'https://open-vsx.org/vscode/api/{publisher}/{name}/latest.json',
		publishUrl: 'https://open-vsx.org/manage',
		galleryEntryPublishedUrl: 'https://open-vsx.org/entry/{publisher}/{name}'
	}
};

/**
 * Upstream defaults that must not survive into Surf. `trustedExtensionAuthAccess`
 * hands GitHub/Microsoft sign-ins to the Copilot extensions, the auto-update list
 * would reinstall them, `voiceWsUrl` is a Microsoft realtime voice endpoint and
 * `reportIssueUrl` opens microsoft/vscode. Legal attribution URLs are untouched.
 */
const COPY_TO_CLEAN = {
	trustedExtensionAuthAccess: {},
	builtInExtensionsEnabledWithAutoUpdates: [],
	reportIssueUrl: ''
};

const KEYS_TO_DROP = ['voiceWsUrl'];

/**
 * The Surf assistant, described in the shape the workbench's chat code expects.
 * This replaces the key outright rather than merging over it: upstream's copy
 * points at the Copilot extensions and carries Copilot command ids whose
 * callers use `?? fallback`, so an inherited value would win over the fallback.
 * The 20 fields below are what a Surf window boots and runs with.
 */
const CHAT_AGENT = {
	extensionId: 'surf-ai.surf-ai',
	chatExtensionId: 'surf-ai.surf-ai',
	chatExtensionOutputId: 'Surf AI',
	documentationUrl: 'https://synap.surf/docs/ide',
	skusDocumentationUrl: 'https://synap.surf/pricing',
	optimizeUsageDocumentationUrl: 'https://synap.surf/docs/ide/usage',
	publicCodeMatchesUrl: 'https://synap.surf/privacy',
	managePlanUrl: 'https://synap.surf/account',
	upgradePlanUrl: 'https://synap.surf/pricing',
	signUpUrl: 'https://synap.surf/signup',
	termsStatementUrl: 'https://synap.surf/terms',
	privacyStatementUrl: 'https://synap.surf/privacy',
	provider: {
		default: { id: 'surf', name: 'Surf' },
		enterprise: { id: 'surf-enterprise', name: 'Surf' },
		google: { id: 'google', name: 'Google' },
		apple: { id: 'apple', name: 'Apple' },
		microsoft: { id: 'microsoft', name: 'Microsoft' }
	},
	providerExtensionId: 'surf-ai.surf-ai',
	providerUriSetting: 'surf.gatewayBaseUrl',
	providerScopes: [],
	entitlementUrl: 'https://api.synap.surf/v1/entitlement',
	entitlementSignupLimitedUrl: 'https://synap.surf/pricing',
	tokenEntitlementUrl: 'https://api.synap.surf/v1/token-entitlement',
	managedSettingsUrl: 'https://synap.surf/account'
};

const ENABLEMENT_FILE = 'src/vs/workbench/services/extensionManagement/browser/extensionEnablementService.ts';
const CHAT_SETTINGS_FILE = 'src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts';
const CHAT_SETUP_FILE = 'src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupContributions.ts';

/** Exact upstream fragments and the Surf versions they become, grouped per file. */
const SOURCE_EDITS = [
	{
		file: ENABLEMENT_FILE,
		edits: [
			{
				marker: 'Surf ships a single extension for both completions and chat',
				from: `\t\tif (!this._chatExtensionId || this.environmentService.isSessionsWindow || this.environmentService.skipBuiltinExtensions?.some(id => id.toLowerCase() === this._chatExtensionId)) {\n\t\t\treturn;\n\t\t}\n`,
				to: `\t\tif (!this._chatExtensionId || this.environmentService.isSessionsWindow || this.environmentService.skipBuiltinExtensions?.some(id => id.toLowerCase() === this._chatExtensionId)) {\n\t\t\treturn;\n\t\t}\n\n\t\t// Surf ships a single extension for both completions and chat, so the builtin chat extension\n\t\t// is the product itself and must never be disabled on a fresh profile.\n\t\tif (this._completionsExtensionId === this._chatExtensionId) {\n\t\t\treturn;\n\t\t}\n`
			},
			{
				marker: 'there is no separate completions extension to retire',
				from: `\t\treturn this._extensionUnificationEnabled && identifier.id.toLowerCase() === this._completionsExtensionId;`,
				to: `\t\t// Unification retires the completions extension in favour of the chat extension. Surf ships\n\t\t// both in one extension, so there is no separate completions extension to retire.\n\t\treturn this._extensionUnificationEnabled && this._completionsExtensionId !== this._chatExtensionId && identifier.id.toLowerCase() === this._completionsExtensionId;`
			}
		]
	},
	{
		file: CHAT_SETTINGS_FILE,
		edits: [
			{
				marker: 'Surf is the assistant this product ships',
				from: `\t\t[ChatAIDisabledSettingId]: {\n\t\t\ttype: 'boolean',\n\t\t\tdescription: nls.localize('chat.disableAIFeatures', "Disable and hide built-in AI features provided by GitHub Copilot, including chat and inline suggestions."),\n\t\t\tdefault: false,\n`,
				to: `\t\t[ChatAIDisabledSettingId]: {\n\t\t\ttype: 'boolean',\n\t\t\tdescription: nls.localize('chat.disableAIFeatures', "Disable and hide the built-in chat and inline suggestion features that Surf AI replaces."),\n\t\t\t// Surf is the assistant this product ships, so the built-in chat surface starts\n\t\t\t// hidden. A default rather than a written setting: changing this mid-session makes\n\t\t\t// the workbench re-register its views and Surf AI's own view goes with them.\n\t\t\tdefault: true,\n`
			}
		]
	},
	{
		file: CHAT_SETUP_FILE,
		edits: [
			{
				marker: 'Surf ships its assistant as the built-in chat extension',
				from: `\t\tthis._register(this.extensionsWorkbenchService.onChange(e => {\n\t\t\tif (e && !ExtensionIdentifier.equals(e.identifier.id, defaultChat.chatExtensionId)) {\n\t\t\t\treturn; // unrelated event\n\t\t\t}\n`,
				to: `\t\tthis._register(this.extensionsWorkbenchService.onChange(e => {\n\t\t\tif (e && !ExtensionIdentifier.equals(e.identifier.id, defaultChat.chatExtensionId)) {\n\t\t\t\treturn; // unrelated event\n\t\t\t}\n\n\t\t\t// Surf ships its assistant as the built-in chat extension, so that extension is\n\t\t\t// always installed and enabled and this event says nothing about the user. Only\n\t\t\t// undo an explicit opt-out, otherwise the product default never survives.\n\t\t\tif (this.configurationService.inspect(ChatAIDisabledSettingId).userValue === undefined) {\n\t\t\t\treturn;\n\t\t\t}\n`
			},
			{
				marker: 'toggle must not enable or disable the product',
				from: `\t\tif (!defaultChatExtension?.local) {\n\t\t\treturn;\n\t\t}\n`,
				to: `\t\tif (!defaultChatExtension?.local) {\n\t\t\treturn;\n\t\t}\n\n\t\t// Surf ships its assistant as the built-in chat extension, so the AI features\n\t\t// toggle must not enable or disable the product's own extension.\n\t\tif (defaultChatExtension.isBuiltin) {\n\t\t\treturn;\n\t\t}\n`
			}
		]
	}
];

const changes = [];

function fail(message) {
	console.error(`\n✗ ${message}`);
	process.exit(1);
}

if (!existsSync(join(FORK, 'product.json'))) {
	fail(`no VS Code checkout at ${FORK} — run surf-ide/setup.sh first`);
}

// --- product.json -----------------------------------------------------------

const productPath = join(FORK, 'product.json');
const product = JSON.parse(readFileSync(productPath, 'utf8'));

for (const [key, value] of Object.entries(BRANDING)) {
	const wanted = JSON.stringify(value);
	if (JSON.stringify(product[key]) !== wanted) {
		product[key] = value;
		changes.push(`product.json: ${key}`);
	}
}

if (JSON.stringify(product.defaultChatAgent) !== JSON.stringify(CHAT_AGENT)) {
	product.defaultChatAgent = CHAT_AGENT;
	changes.push('product.json: defaultChatAgent');
}

for (const [key, value] of Object.entries(COPY_TO_CLEAN)) {
	if (key in product && JSON.stringify(product[key]) !== JSON.stringify(value)) {
		product[key] = value;
		changes.push(`product.json: ${key} cleared`);
	}
}

for (const key of KEYS_TO_DROP) {
	if (key in product) {
		delete product[key];
		changes.push(`product.json: ${key} removed`);
	}
}

if (changes.length) {
	writeFileSync(productPath, JSON.stringify(product, null, '\t') + '\n');
}

// --- workbench sources ------------------------------------------------------

for (const { file, edits } of SOURCE_EDITS) {
	const path = join(FORK, file);
	if (!existsSync(path)) {
		fail(`${file} is missing — this script expects a VS Code checkout at ${FORK}`);
	}
	let source = readFileSync(path, 'utf8');
	for (const edit of edits) {
		if (source.includes(edit.marker)) {
			continue;
		}
		if (!source.includes(edit.from)) {
			fail(`${file} has changed upstream; re-derive the Surf patch for this fragment:\n${edit.from.trim()}`);
		}
		source = source.replace(edit.from, edit.to);
		if (!changes.includes(file)) {
			changes.push(file);
		}
	}
	writeFileSync(path, source);
}

// --- the extension itself ---------------------------------------------------

if (!existsSync(join(FORK, 'extensions/surf-ai/package.json'))) {
	fail('extensions/surf-ai is missing — it is tracked in this repository, check the checkout');
}

for (const change of changes) {
	console.log(`  · ${change}`);
}
console.log(changes.length ? `\n✓ Surf IDE changes applied to ${FORK}` : '\n✓ Surf IDE changes already applied');
