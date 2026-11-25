import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

// Minimal typings for the parts of @electron/remote this plugin uses.
// Obsidian ships @electron/remote at runtime, so it is not bundled.
type NativeImage = object;

interface BrowserWindow {
	setOverlayIcon(overlay: NativeImage | null, description: string): void;
}

interface Remote {
	getCurrentWindow(): BrowserWindow;
	nativeImage: {
		createFromDataURL(dataURL: string): NativeImage;
	};
}

declare function require(id: string): unknown;

type LetterSize = "small" | "medium" | "large";

// Font size relative to the badge size.
const SIZE_RATIOS: Record<LetterSize, number> = {
	small: 0.55,
	medium: 0.7,
	large: 0.85,
};

interface LetterBadgeSettings {
	letter: string;
	color: string;
	size: LetterSize;
}

const DEFAULT_SETTINGS: LetterBadgeSettings = {
	letter: "",
	color: "#7f6df2",
	size: "large",
};

// Windows shows overlay icons at 16x16; draw at 2x so it stays sharp on high-DPI displays.
const CANVAS_SIZE = 32;
const CORNER_RADIUS = 6;

export default class LetterBadgePlugin extends Plugin {
	settings: LetterBadgeSettings;
	private remote: Remote;

	async onload() {
		await this.loadSettings();
		this.remote = require("@electron/remote") as Remote;

		this.addSettingTab(new LetterBadgeSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => this.updateBadge());

		// When several windows share one taskbar button, Windows shows the overlay
		// that was set last, so re-apply it whenever this window gets focus.
		this.registerDomEvent(window, "focus", () => this.updateBadge());
	}

	onunload() {
		this.remote?.getCurrentWindow().setOverlayIcon(null, "");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	defaultLetter(): string {
		return firstChar(this.app.vault.getName()).toUpperCase();
	}

	badgeLetter(): string {
		const letter = firstChar(this.settings.letter.trim());
		return letter ? letter.toUpperCase() : this.defaultLetter();
	}

	updateBadge() {
		const dataURL = renderBadge(
			this.badgeLetter(),
			this.settings.color,
			SIZE_RATIOS[this.settings.size] ?? SIZE_RATIOS.large
		);
		if (!dataURL) return;

		const image = this.remote.nativeImage.createFromDataURL(dataURL);
		this.remote.getCurrentWindow().setOverlayIcon(image, this.app.vault.getName());
	}
}

function firstChar(text: string): string {
	// Array.from keeps surrogate pairs together.
	return Array.from(text)[0] ?? "";
}

function renderBadge(letter: string, color: string, sizeRatio: number): string | null {
	const canvas = document.createElement("canvas");
	canvas.width = CANVAS_SIZE;
	canvas.height = CANVAS_SIZE;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.roundRect(0, 0, CANVAS_SIZE, CANVAS_SIZE, CORNER_RADIUS);
	ctx.fill();

	ctx.fillStyle = textColorFor(color);
	ctx.font = `bold ${Math.round(CANVAS_SIZE * sizeRatio)}px sans-serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "alphabetic";

	// Center the glyph's actual ink box, not the font's em box.
	const metrics = ctx.measureText(letter);
	const y =
		(CANVAS_SIZE + metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
	ctx.fillText(letter, CANVAS_SIZE / 2, y);

	return canvas.toDataURL("image/png");
}

function textColorFor(hex: string): string {
	const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!match) return "#ffffff";
	const [r, g, b] = match.slice(1).map((h) => parseInt(h, 16));
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return luminance > 0.6 ? "#000000" : "#ffffff";
}

class LetterBadgeSettingTab extends PluginSettingTab {
	plugin: LetterBadgePlugin;

	constructor(app: App, plugin: LetterBadgePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Letter")
			.setDesc("The character shown on the badge. Leave empty to use the first letter of the vault name.")
			.addText((text) => {
				text.inputEl.maxLength = 1;
				text
					.setPlaceholder(this.plugin.defaultLetter())
					.setValue(this.plugin.settings.letter)
					.onChange(async (value) => {
						this.plugin.settings.letter = value;
						await this.save();
					});
			});

		new Setting(containerEl)
			.setName("Background color")
			.addColorPicker((picker) =>
				picker.setValue(this.plugin.settings.color).onChange(async (value) => {
					this.plugin.settings.color = value;
					await this.save();
				})
			);

		new Setting(containerEl)
			.setName("Letter size")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ small: "Small", medium: "Medium", large: "Large" })
					.setValue(this.plugin.settings.size)
					.onChange(async (value) => {
						this.plugin.settings.size = value as LetterSize;
						await this.save();
					})
			);
	}

	private async save() {
		await this.plugin.saveSettings();
		this.plugin.updateBadge();
	}
}
