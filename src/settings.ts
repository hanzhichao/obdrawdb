import { App, PluginSettingTab, Setting } from "obsidian";
import type DrawDBPlugin from "./main";
import { DATABASE_TYPES } from "./types";

export interface DrawDBSettings {
	defaultDatabase: string;
}

export const DEFAULT_SETTINGS: DrawDBSettings = {
	defaultDatabase: "MySQL",
};

export class DrawDBSettingTab extends PluginSettingTab {
	plugin: DrawDBPlugin;

	constructor(app: App, plugin: DrawDBPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "DrawDB Settings" });

		new Setting(containerEl)
			.setName("Default database type")
			.setDesc("Database type used when creating new diagrams.")
			.addDropdown(drop => {
				DATABASE_TYPES.forEach(db => drop.addOption(db, db));
				drop.setValue(this.plugin.settings.defaultDatabase);
				drop.onChange(async (value) => {
					this.plugin.settings.defaultDatabase = value;
					await this.plugin.saveSettings();
				});
			});
	}
}
