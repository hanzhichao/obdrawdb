import { Plugin, TFile } from "obsidian";
import { VIEW_TYPE_DRAWDB, DrawDBView } from "./DrawDBView";
import { DrawDBSettings, DEFAULT_SETTINGS, DrawDBSettingTab } from "./settings";

export default class DrawDBPlugin extends Plugin {
	settings: DrawDBSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_DRAWDB, (leaf) => new DrawDBView(leaf, this));
		this.registerExtensions(["drawdb"], VIEW_TYPE_DRAWDB);

		this.addRibbonIcon("database", "New DrawDB diagram", () => {
			void this.createNewDiagram();
		});

		this.addCommand({
			id: "new-drawdb-diagram",
			name: "New diagram",
			callback: () => { void this.createNewDiagram(); },
		});

		this.addSettingTab(new DrawDBSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<DrawDBSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async createNewDiagram(): Promise<void> {
		let path = "diagram.drawdb";
		let counter = 1;
		while (this.app.vault.getAbstractFileByPath(path)) {
			path = `diagram-${counter++}.drawdb`;
		}

		const content = JSON.stringify({
			database: this.settings.defaultDatabase,
			tables: [],
			references: [],
			notes: [],
			areas: [],
		}, null, 2);

		const file = await this.app.vault.create(path, content);
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
	}

	async openDiagram(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
	}
}
