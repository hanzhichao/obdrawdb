import { ItemView, WorkspaceLeaf, TFile, Notice, ViewStateResult } from "obsidian";
import { DiagramEditor } from "./editor/DiagramEditor";
import { DrawDBDiagram } from "./types";
import type DrawDBPlugin from "./main";

export const VIEW_TYPE_DRAWDB = "drawdb-view";

export class DrawDBView extends ItemView {
	private plugin: DrawDBPlugin;
	private editor: DiagramEditor | null = null;
	private file: TFile | null = null;
	private pendingFilePath: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: DrawDBPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_DRAWDB;
	}

	getDisplayText(): string {
		return this.file?.basename ?? "DrawDB Diagram";
	}

	getIcon(): string {
		return "database";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("drawdb-view-container");

		this.editor = new DiagramEditor(container, {
			onSave: async (diagram: DrawDBDiagram) => {
				await this.saveDiagram(diagram);
			},
			onDirty: () => {
				// no-op: header update not needed
			},
		});

		if (this.pendingFilePath) {
			const filePath = this.pendingFilePath;
			this.pendingFilePath = null;
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) {
				await this.loadFile(file);
			}
		}
	}

	async onClose(): Promise<void> {
		this.editor?.destroy();
		this.editor = null;
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = state as Record<string, unknown>;
		if (typeof s?.file === "string") {
			if (this.editor) {
				const file = this.app.vault.getAbstractFileByPath(s.file);
				if (file instanceof TFile) {
					await this.loadFile(file);
				}
			} else {
				this.pendingFilePath = s.file;
			}
		}
		await super.setState(state, result);
	}

	getState(): Record<string, unknown> {
		// super.getState() returns ViewState, but we extend with file path
		const state: Record<string, unknown> = {};
		if (this.file) {
			state.file = this.file.path;
		}
		return state;
	}

	async loadFile(file: TFile): Promise<void> {
		this.file = file;
		let diagram: DrawDBDiagram = {
			database: this.plugin.settings.defaultDatabase,
			tables: [],
			references: [],
			notes: [],
			areas: [],
		};
		try {
			const content = await this.app.vault.read(file);
			if (content.trim()) {
				diagram = JSON.parse(content) as DrawDBDiagram;
			}
		} catch {
			// Use empty diagram on parse failure
		}
		this.editor?.loadDiagram(diagram);
	}

	private async saveDiagram(diagram: DrawDBDiagram): Promise<void> {
		if (!this.file) {
			new Notice("No file associated with this diagram");
			return;
		}
		try {
			await this.app.vault.modify(this.file, JSON.stringify(diagram, null, 2));
			new Notice("Diagram saved");
		} catch (e) {
			new Notice("Failed to save diagram");
		}
	}
}
