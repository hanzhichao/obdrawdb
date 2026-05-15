import {
	DrawDBDiagram, DrawDBTable, DrawDBField, DrawDBReference,
	TABLE_COLORS, getFieldTypes, createDefaultField,
	CARDINALITY_TYPES, CONSTRAINT_BEHAVIORS, DATABASE_TYPES,
} from "../types";

const TABLE_WIDTH = 220;
const TABLE_HEADER_HEIGHT = 36;
const FIELD_HEIGHT = 30;
const MIN_SCALE = 0.1;
const MAX_SCALE = 3;

type EditorMode = "select" | "relation";

export interface DiagramEditorOptions {
	onSave?: (diagram: DrawDBDiagram) => Promise<void>;
	onDirty?: () => void;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
	return activeDocument.createElementNS("http://www.w3.org/2000/svg", tag);
}

export class DiagramEditor {
	private container: HTMLElement;
	private options: DiagramEditorOptions;
	private diagram: DrawDBDiagram;

	// DOM refs
	private wrapper: HTMLElement;
	private toolbar: HTMLElement;
	private body: HTMLElement;
	private canvasWrapper: HTMLElement;
	private canvas: HTMLElement;
	private svgLayer: SVGSVGElement;
	private propertiesPanel: HTMLElement;

	// Toolbar button refs
	private undoBtn!: HTMLButtonElement;
	private redoBtn!: HTMLButtonElement;
	private zoomLabel!: HTMLElement;
	private selectBtn!: HTMLButtonElement;
	private relationBtn!: HTMLButtonElement;

	// Canvas state
	private panX = 40;
	private panY = 40;
	private scale = 1;
	private mode: EditorMode = "select";

	// Selection
	private selectedTableId: number | null = null;
	private selectedFieldId: number | null = null;
	private selectedRefId: number | null = null;

	// Table dragging
	private isDraggingTable = false;
	private draggingTableId: number | null = null;
	private dragStartMouseX = 0;
	private dragStartMouseY = 0;
	private dragStartTableX = 0;
	private dragStartTableY = 0;

	// Canvas panning
	private isPanning = false;
	private panStartMouseX = 0;
	private panStartMouseY = 0;
	private panStartX = 0;
	private panStartY = 0;
	private spaceHeld = false;

	// Relation drawing
	private isDrawingRelation = false;
	private relStartTableId: number | null = null;
	private relStartFieldId: number | null = null;
	private relTempLine: SVGPathElement | null = null;

	// ID counter
	private nextId = 1;

	// History
	private history: string[] = [];
	private historyIndex = -1;

	// Bound event handlers for cleanup
	private boundMouseMove: (e: MouseEvent) => void;
	private boundMouseUp: (e: MouseEvent) => void;
	private boundKeyDown: (e: KeyboardEvent) => void;
	private boundKeyUp: (e: KeyboardEvent) => void;

	constructor(container: HTMLElement, options: DiagramEditorOptions) {
		this.container = container;
		this.options = options;
		this.diagram = { database: "MySQL", tables: [], references: [], notes: [], areas: [] };

		this.boundMouseMove = this.onMouseMove.bind(this);
		this.boundMouseUp = this.onMouseUp.bind(this);
		this.boundKeyDown = this.onKeyDown.bind(this);
		this.boundKeyUp = this.onKeyUp.bind(this);

		this.wrapper = container.createDiv({ cls: "drawdb-wrapper" });
		this.toolbar = this.wrapper.createDiv({ cls: "drawdb-toolbar" });
		this.body = this.wrapper.createDiv({ cls: "drawdb-body" });

		this.canvasWrapper = this.body.createDiv({ cls: "drawdb-canvas-wrapper" });

		// SVG for connections — rendered below canvas
		this.svgLayer = svgEl("svg");
		this.svgLayer.classList.add("drawdb-svg");
		this.svgLayer.setAttribute("xmlns", "http://www.w3.org/2000/svg");
		this.canvasWrapper.appendChild(this.svgLayer);

		// Arrow markers
		const defs = svgEl("defs");
		const marker = svgEl("marker");
		marker.setAttribute("id", "ddb-arrow-end");
		marker.setAttribute("markerWidth", "8");
		marker.setAttribute("markerHeight", "8");
		marker.setAttribute("refX", "7");
		marker.setAttribute("refY", "3");
		marker.setAttribute("orient", "auto");

		const path = svgEl("path");
		path.setAttribute("d", "M0,0 L0,6 L8,3 z");
		path.setAttribute("class", "drawdb-arrow-fill");

		marker.appendChild(path);
		defs.appendChild(marker);
		this.svgLayer.appendChild(defs);

		this.canvas = this.canvasWrapper.createDiv({ cls: "drawdb-canvas" });
		this.propertiesPanel = this.body.createDiv({ cls: "drawdb-properties" });

		this.buildToolbar();
		this.buildPropertiesPanel();
		this.attachCanvasEvents();
		activeDocument.addEventListener("mousemove", this.boundMouseMove);
		activeDocument.addEventListener("mouseup", this.boundMouseUp);
		activeDocument.addEventListener("keydown", this.boundKeyDown);
		activeDocument.addEventListener("keyup", this.boundKeyUp);

		this.pushHistory();
	}

	// ─── Public API ────────────────────────────────────────────────────────────

	loadDiagram(diagram: DrawDBDiagram): void {
		this.diagram = diagram;
		this.selectedTableId = null;
		this.selectedFieldId = null;
		this.selectedRefId = null;

		// Compute nextId from existing data
		let maxId = 0;
		for (const t of diagram.tables) {
			if (t.id > maxId) maxId = t.id;
			for (const f of t.fields) if (f.id > maxId) maxId = f.id;
		}
		for (const r of diagram.references) if (r.id > maxId) maxId = r.id;
		this.nextId = maxId + 1;

		this.history = [];
		this.historyIndex = -1;
		this.pushHistory();

		this.render();
		this.fitToScreen();
	}

	destroy(): void {
		activeDocument.removeEventListener("mousemove", this.boundMouseMove);
		activeDocument.removeEventListener("mouseup", this.boundMouseUp);
		activeDocument.removeEventListener("keydown", this.boundKeyDown);
		activeDocument.removeEventListener("keyup", this.boundKeyUp);
		this.container.empty();
	}

	// ─── Toolbar ───────────────────────────────────────────────────────────────

	private buildToolbar(): void {
		this.toolbar.empty();

		// Mode: select
		this.selectBtn = this.toolbar.createEl("button", { cls: "drawdb-toolbar-btn", text: "Select" });
		this.selectBtn.addEventListener("click", () => this.setMode("select"));

		// Mode: draw relation
		this.relationBtn = this.toolbar.createEl("button", { cls: "drawdb-toolbar-btn", text: "Draw Relation" });
		this.relationBtn.addEventListener("click", () => this.setMode("relation"));

		this.toolbar.createDiv({ cls: "drawdb-toolbar-sep" });

		// Add table
		const addTableBtn = this.toolbar.createEl("button", { cls: "drawdb-toolbar-btn", text: "+ Table" });
		addTableBtn.addEventListener("click", () => this.addTable());

		this.toolbar.createDiv({ cls: "drawdb-toolbar-sep" });

		// Undo / Redo
		this.undoBtn = this.toolbar.createEl("button", { cls: "drawdb-toolbar-btn", text: "↩ Undo" });
		this.undoBtn.addEventListener("click", () => this.undo());

		this.redoBtn = this.toolbar.createEl("button", { cls: "drawdb-toolbar-btn", text: "↪ Redo" });
		this.redoBtn.addEventListener("click", () => this.redo());

		this.toolbar.createDiv({ cls: "drawdb-toolbar-sep" });

		// Zoom controls
		const zoomOutBtn = this.toolbar.createEl("button", { cls: "drawdb-toolbar-btn", text: "−" });
		zoomOutBtn.addEventListener("click", () => this.setZoom(this.scale * 0.8));

		this.zoomLabel = this.toolbar.createEl("span", { cls: "drawdb-toolbar-zoom", text: "100%" });

		const zoomInBtn = this.toolbar.createEl("button", { cls: "drawdb-toolbar-btn", text: "+" });
		zoomInBtn.addEventListener("click", () => this.setZoom(this.scale * 1.25));

		const fitBtn = this.toolbar.createEl("button", { cls: "drawdb-toolbar-btn", text: "Fit" });
		fitBtn.addEventListener("click", () => this.fitToScreen());

		this.toolbar.createDiv({ cls: "drawdb-toolbar-sep" });

		// Database type selector
		const dbSel = this.toolbar.createEl("select", { cls: "drawdb-toolbar-select" });
		DATABASE_TYPES.forEach(db => {
			const opt = dbSel.createEl("option", { text: db, value: db });
			if (db === this.diagram.database) opt.selected = true;
		});
		dbSel.addEventListener("change", () => {
			this.diagram.database = dbSel.value;
			this.markDirty();
			if (this.selectedFieldId !== null) this.renderPropertiesPanel();
		});

		this.toolbar.createDiv({ cls: "drawdb-toolbar-sep" });

		// Save
		const saveBtn = this.toolbar.createEl("button", { cls: "drawdb-toolbar-btn drawdb-btn-accent", text: "Save" });
		saveBtn.addEventListener("click", () => void this.save());

		// Export SQL
		const exportBtn = this.toolbar.createEl("button", { cls: "drawdb-toolbar-btn", text: "Export SQL" });
		exportBtn.addEventListener("click", () => this.exportSQL());

		this.updateModeButtons();
		this.updateHistoryButtons();
		this.updateZoomLabel();
	}

	private setMode(mode: EditorMode): void {
		this.mode = mode;
		if (mode === "select") {
			this.cancelRelationDrawing();
		}
		this.updateModeButtons();
	}

	private updateModeButtons(): void {
		if (this.selectBtn) {
			this.selectBtn.classList.toggle("active", this.mode === "select");
		}
		if (this.relationBtn) {
			this.relationBtn.classList.toggle("active", this.mode === "relation");
		}
	}

	private updateHistoryButtons(): void {
		if (this.undoBtn) this.undoBtn.disabled = this.historyIndex <= 0;
		if (this.redoBtn) this.redoBtn.disabled = this.historyIndex >= this.history.length - 1;
	}

	private updateZoomLabel(): void {
		if (this.zoomLabel) {
			this.zoomLabel.textContent = Math.round(this.scale * 100) + "%";
		}
	}

	// ─── Properties panel ──────────────────────────────────────────────────────

	private buildPropertiesPanel(): void {
		this.propertiesPanel.empty();
		this.renderPropertiesPanel();
	}

	private renderPropertiesPanel(): void {
		this.propertiesPanel.empty();

		if (this.selectedTableId !== null) {
			const table = this.diagram.tables.find(t => t.id === this.selectedTableId);
			if (table) { this.renderTableProps(table); return; }
		}

		if (this.selectedRefId !== null) {
			const ref = this.diagram.references.find(r => r.id === this.selectedRefId);
			if (ref) { this.renderRefProps(ref); return; }
		}

		// Empty hint
		const hint = this.propertiesPanel.createDiv({ cls: "drawdb-prop-hint" });
		hint.createEl("p", { text: "Select a table or relationship to edit its properties." });
		hint.createEl("p", { text: "Double-click on the canvas to add a new table." });
		hint.createEl("p", { text: "Use 'Draw Relation' mode to create relationships between fields." });
	}

	private renderTableProps(table: DrawDBTable): void {
		const p = this.propertiesPanel;

		p.createEl("h3", { cls: "drawdb-prop-heading", text: "Table" });

		// Name
		this.propRow(p, "Name", row => {
			const inp = row.createEl("input", { cls: "drawdb-prop-input", type: "text", value: table.name });
			inp.addEventListener("change", () => {
				table.name = inp.value;
				this.reRenderTable(table);
				this.markDirty();
			});
		});

		// Color
		this.propRow(p, "Color", row => {
			const picker = row.createDiv({ cls: "drawdb-color-picker" });
			TABLE_COLORS.forEach(color => {
				const sw = picker.createDiv({ cls: "drawdb-color-swatch" });
				sw.style.backgroundColor = color;
				if (color === table.color) sw.classList.add("selected");
				sw.addEventListener("click", () => {
					table.color = color;
					picker.querySelectorAll(".drawdb-color-swatch").forEach(s => s.classList.remove("selected"));
					sw.classList.add("selected");
					this.reRenderTable(table);
					this.markDirty();
				});
			});
		});

		// Comment
		this.propRow(p, "Comment", row => {
			const inp = row.createEl("input", { cls: "drawdb-prop-input", type: "text", value: table.comment });
			inp.addEventListener("change", () => { table.comment = inp.value; this.markDirty(); });
		});

		// Delete table button
		const delBtn = p.createEl("button", { cls: "drawdb-btn-danger", text: "Delete Table" });
		delBtn.addEventListener("click", () => this.deleteTable(table.id));

		// Fields section
		p.createEl("h3", { cls: "drawdb-prop-heading", text: "Fields" });

		table.fields.forEach(field => {
			const row = p.createDiv({ cls: "drawdb-field-prop-row" });
			if (this.selectedFieldId === field.id) row.classList.add("selected");
			row.createSpan({ cls: "drawdb-field-prop-pk", text: field.primary ? "🔑" : "○" });
			row.createSpan({ cls: "drawdb-field-prop-name", text: field.name });
			row.createSpan({ cls: "drawdb-field-prop-type", text: field.type });

			row.addEventListener("click", () => {
				this.selectedFieldId = this.selectedFieldId === field.id ? null : field.id;
				this.renderPropertiesPanel();
			});

			if (this.selectedFieldId === field.id) {
				this.renderFieldDetails(p, field, table);
			}
		});

		const addFieldBtn = p.createEl("button", { cls: "drawdb-btn-secondary drawdb-btn-block", text: "+ Add Field" });
		addFieldBtn.addEventListener("click", () => {
			const f = createDefaultField(this.nextId++);
			table.fields.push(f);
			this.selectedFieldId = f.id;
			this.reRenderTable(table);
			this.renderPropertiesPanel();
			this.markDirty();
		});
	}

	private renderFieldDetails(container: HTMLElement, field: DrawDBField, table: DrawDBTable): void {
		const box = container.createDiv({ cls: "drawdb-field-detail" });

		// Name
		this.propRow(box, "Name", row => {
			const inp = row.createEl("input", { cls: "drawdb-prop-input", type: "text", value: field.name });
			inp.addEventListener("change", () => {
				field.name = inp.value;
				this.reRenderTable(table);
				this.markDirty();
			});
		});

		// Type
		this.propRow(box, "Type", row => {
			const sel = row.createEl("select", { cls: "drawdb-prop-select" });
			getFieldTypes(this.diagram.database).forEach(t => {
				const opt = sel.createEl("option", { text: t, value: t });
				if (t === field.type) opt.selected = true;
			});
			sel.addEventListener("change", () => {
				field.type = sel.value;
				this.reRenderTable(table);
				this.markDirty();
			});
		});

		// Size
		this.propRow(box, "Size", row => {
			const inp = row.createEl("input", { cls: "drawdb-prop-input drawdb-prop-input-sm", type: "text", value: field.size });
			inp.addEventListener("change", () => { field.size = inp.value; this.reRenderTable(table); this.markDirty(); });
		});

		// Default
		this.propRow(box, "Default", row => {
			const inp = row.createEl("input", { cls: "drawdb-prop-input", type: "text", value: field.default });
			inp.addEventListener("change", () => { field.default = inp.value; this.markDirty(); });
		});

		// Checkboxes
		const checks: Array<[string, keyof Pick<DrawDBField, "primary" | "unique" | "notnull" | "autoincrement">]> = [
			["Primary Key", "primary"],
			["Unique", "unique"],
			["Not Null", "notnull"],
			["Auto Increment", "autoincrement"],
		];
		checks.forEach(([label, key]) => {
			const r = box.createDiv({ cls: "drawdb-prop-check-row" });
			const cb = r.createEl("input", { type: "checkbox" });
			cb.checked = field[key];
			r.createEl("label", { text: label });
			cb.addEventListener("change", () => {
				(field as unknown as Record<string, boolean>)[key] = cb.checked;
				if (key === "primary") { this.reRenderTable(table); this.renderPropertiesPanel(); }
				this.markDirty();
			});
		});

		// Comment
		this.propRow(box, "Comment", row => {
			const inp = row.createEl("input", { cls: "drawdb-prop-input", type: "text", value: field.comment });
			inp.addEventListener("change", () => { field.comment = inp.value; this.markDirty(); });
		});

		// Delete field
		const delBtn = box.createEl("button", { cls: "drawdb-btn-danger drawdb-btn-sm drawdb-btn-block", text: "Delete Field" });
		delBtn.addEventListener("click", () => {
			table.fields = table.fields.filter(f => f.id !== field.id);
			this.diagram.references = this.diagram.references.filter(
				r => !(r.startTableId === table.id && r.startFieldId === field.id) &&
					 !(r.endTableId === table.id && r.endFieldId === field.id)
			);
			this.selectedFieldId = null;
			this.reRenderTable(table);
			this.renderConnections();
			this.renderPropertiesPanel();
			this.markDirty();
		});
	}

	private renderRefProps(ref: DrawDBReference): void {
		const p = this.propertiesPanel;
		p.createEl("h3", { cls: "drawdb-prop-heading", text: "Relationship" });

		this.propRow(p, "Name", row => {
			const inp = row.createEl("input", { cls: "drawdb-prop-input", type: "text", value: ref.name });
			inp.addEventListener("change", () => {
				ref.name = inp.value;
				this.renderConnections();
				this.markDirty();
			});
		});

		this.propSelectRow(p, "Cardinality", CARDINALITY_TYPES, ref.cardinality, v => {
			ref.cardinality = v; this.markDirty();
		});
		this.propSelectRow(p, "On Update", CONSTRAINT_BEHAVIORS, ref.updateBehavior, v => {
			ref.updateBehavior = v; this.markDirty();
		});
		this.propSelectRow(p, "On Delete", CONSTRAINT_BEHAVIORS, ref.deleteBehavior, v => {
			ref.deleteBehavior = v; this.markDirty();
		});

		// Info
		const st = this.diagram.tables.find(t => t.id === ref.startTableId);
		const et = this.diagram.tables.find(t => t.id === ref.endTableId);
		const sf = st?.fields.find(f => f.id === ref.startFieldId);
		const ef = et?.fields.find(f => f.id === ref.endFieldId);
		if (st && et && sf && ef) {
			p.createEl("p", { cls: "drawdb-prop-info", text: `${st.name}.${sf.name} → ${et.name}.${ef.name}` });
		}

		const delBtn = p.createEl("button", { cls: "drawdb-btn-danger", text: "Delete Relationship" });
		delBtn.addEventListener("click", () => {
			this.diagram.references = this.diagram.references.filter(r => r.id !== ref.id);
			this.selectedRefId = null;
			this.renderConnections();
			this.renderPropertiesPanel();
			this.pushHistory();
			this.markDirty();
		});
	}

	// ─── Rendering ─────────────────────────────────────────────────────────────

	private render(): void {
		this.renderTables();
		this.renderConnections();
		this.updateCanvasTransform();
	}

	private renderTables(): void {
		this.canvas.empty();
		for (const table of this.diagram.tables) {
			this.renderTable(table);
		}
	}

	private renderTable(table: DrawDBTable): void {
		const el = this.canvas.createDiv({ cls: "drawdb-table" });
		el.dataset.tableId = String(table.id);
		el.style.left = table.x + "px";
		el.style.top = table.y + "px";
		el.style.width = TABLE_WIDTH + "px";

		if (this.selectedTableId === table.id && this.selectedFieldId === null) {
			el.classList.add("selected");
		}

		// Header
		const header = el.createDiv({ cls: "drawdb-table-header" });
		header.style.backgroundColor = table.color;
		header.createSpan({ cls: "drawdb-table-name", text: table.name });

		header.addEventListener("mousedown", (e: MouseEvent) => {
			if (e.button !== 0 || this.spaceHeld) return;
			e.stopPropagation();
			this.startDragTable(table.id, e);
		});

		header.addEventListener("click", (e: MouseEvent) => {
			e.stopPropagation();
			if (!this.isDraggingTable) {
				this.selectTable(table.id);
			}
		});

		// Fields
		table.fields.forEach((field, idx) => {
			const row = el.createDiv({ cls: "drawdb-field-row" });
			row.dataset.fieldId = String(field.id);
			row.dataset.fieldIdx = String(idx);

			if (this.selectedFieldId === field.id) row.classList.add("selected");

			const keySpan = row.createSpan({ cls: "drawdb-field-key" });
			keySpan.textContent = field.primary ? "🔑" : field.unique ? "◆" : "";

			row.createSpan({ cls: "drawdb-field-name", text: field.name });
			const typeStr = field.size ? `${field.type}(${field.size})` : field.type;
			row.createSpan({ cls: "drawdb-field-type", text: typeStr });

			// Connection anchor (right edge)
			const anchor = row.createDiv({ cls: "drawdb-conn-anchor" });
			anchor.title = "Drag to create relation";

			row.addEventListener("click", (e: MouseEvent) => {
				e.stopPropagation();
				if (this.mode === "relation") {
					this.handleRelationFieldClick(table.id, field.id);
				} else {
					this.selectedTableId = table.id;
					this.selectedFieldId = field.id;
					this.selectedRefId = null;
					this.syncTableSelection();
					this.renderPropertiesPanel();
				}
			});

			if (this.mode === "relation") {
				anchor.classList.add("active");
			}
		});
	}

	private reRenderTable(table: DrawDBTable): void {
		const existing = this.canvas.querySelector(`[data-table-id="${table.id}"]`);
		if (existing) existing.remove();
		this.renderTable(table);
		this.renderConnections();
	}

	private syncTableSelection(): void {
		this.canvas.querySelectorAll<HTMLElement>(".drawdb-table").forEach(el => {
			const tid = parseInt(el.dataset.tableId ?? "0");
			el.classList.toggle("selected", tid === this.selectedTableId && this.selectedFieldId === null);
		});
		this.canvas.querySelectorAll<HTMLElement>(".drawdb-field-row").forEach(el => {
			const fid = parseInt(el.dataset.fieldId ?? "0");
			el.classList.toggle("selected", fid === this.selectedFieldId);
		});
	}

	private renderConnections(): void {
		// Remove existing relation elements (not defs)
		this.svgLayer.querySelectorAll(".drawdb-relation, .drawdb-rel-label").forEach(el => el.remove());
		for (const ref of this.diagram.references) {
			this.renderConnection(ref);
		}
	}

	private renderConnection(ref: DrawDBReference): void {
		const st = this.diagram.tables.find(t => t.id === ref.startTableId);
		const et = this.diagram.tables.find(t => t.id === ref.endTableId);
		if (!st || !et) return;

		const sfIdx = st.fields.findIndex(f => f.id === ref.startFieldId);
		const efIdx = et.fields.findIndex(f => f.id === ref.endFieldId);
		if (sfIdx < 0 || efIdx < 0) return;

		const { x1, y1, x2, y2 } = this.getConnectionCoords(st, sfIdx, et, efIdx);
		const dx = Math.abs(x2 - x1);
		const cp = Math.max(dx / 2, 60);

		const path = svgEl("path");
		path.setAttribute("d", `M${x1},${y1} C${x1 + cp},${y1} ${x2 - cp},${y2} ${x2},${y2}`);
		path.setAttribute("marker-end", "url(#ddb-arrow-end)");
		path.classList.add("drawdb-relation");
		if (this.selectedRefId === ref.id) path.classList.add("selected");
		path.dataset.refId = String(ref.id);

		path.addEventListener("click", (e: MouseEvent) => {
			e.stopPropagation();
			this.selectedRefId = ref.id;
			this.selectedTableId = null;
			this.selectedFieldId = null;
			this.renderConnections();
			this.syncTableSelection();
			this.renderPropertiesPanel();
		});

		this.svgLayer.appendChild(path);

		if (ref.name) {
			const lx = (x1 + x2) / 2;
			const ly = (y1 + y2) / 2 - 6;
			const text = svgEl("text");
			text.setAttribute("x", String(lx));
			text.setAttribute("y", String(ly));
			text.classList.add("drawdb-rel-label");
			text.textContent = ref.name;
			this.svgLayer.appendChild(text);
		}
	}

	private getConnectionCoords(
		st: DrawDBTable, sfIdx: number,
		et: DrawDBTable, efIdx: number
	): { x1: number; y1: number; x2: number; y2: number } {
		const sy = st.y + TABLE_HEADER_HEIGHT + sfIdx * FIELD_HEIGHT + FIELD_HEIGHT / 2;
		const ey = et.y + TABLE_HEADER_HEIGHT + efIdx * FIELD_HEIGHT + FIELD_HEIGHT / 2;

		let x1: number, x2: number;
		if (st.x + TABLE_WIDTH / 2 <= et.x + TABLE_WIDTH / 2) {
			x1 = st.x + TABLE_WIDTH;
			x2 = et.x;
		} else {
			x1 = st.x;
			x2 = et.x + TABLE_WIDTH;
		}

		// Convert diagram coords → screen coords
		return {
			x1: x1 * this.scale + this.panX,
			y1: sy * this.scale + this.panY,
			x2: x2 * this.scale + this.panX,
			y2: ey * this.scale + this.panY,
		};
	}

	private updateCanvasTransform(): void {
		this.canvas.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
		this.updateZoomLabel();
	}

	// ─── Table management ──────────────────────────────────────────────────────

	private addTable(): void {
		const cx = (this.canvasWrapper.clientWidth / 2 - this.panX) / this.scale;
		const cy = (this.canvasWrapper.clientHeight / 2 - this.panY) / this.scale;
		this.addTableAt(cx, cy);
	}

	private addTableAt(x: number, y: number): void {
		const table: DrawDBTable = {
			id: this.nextId++,
			name: "table_" + this.diagram.tables.length,
			x: Math.max(0, x - TABLE_WIDTH / 2),
			y: Math.max(0, y - TABLE_HEADER_HEIGHT / 2),
			color: TABLE_COLORS[this.diagram.tables.length % TABLE_COLORS.length] ?? "#175e7a",
			comment: "",
			fields: [{
				id: this.nextId++,
				name: "id",
				type: "INT",
				default: "",
				primary: true,
				unique: true,
				notnull: true,
				autoincrement: true,
				comment: "",
				size: "",
				check: "",
				values: [],
			}],
			indices: [],
		};
		this.diagram.tables.push(table);
		this.renderTable(table);
		this.selectTable(table.id);
		this.pushHistory();
		this.markDirty();
	}

	private deleteTable(tableId: number): void {
		this.diagram.tables = this.diagram.tables.filter(t => t.id !== tableId);
		this.diagram.references = this.diagram.references.filter(
			r => r.startTableId !== tableId && r.endTableId !== tableId
		);
		this.selectedTableId = null;
		this.selectedFieldId = null;
		this.renderTables();
		this.renderConnections();
		this.renderPropertiesPanel();
		this.pushHistory();
		this.markDirty();
	}

	private selectTable(tableId: number): void {
		this.selectedTableId = tableId;
		this.selectedFieldId = null;
		this.selectedRefId = null;
		this.syncTableSelection();
		this.renderConnections();
		this.renderPropertiesPanel();
	}

	// ─── Drag ──────────────────────────────────────────────────────────────────

	private startDragTable(tableId: number, e: MouseEvent): void {
		const table = this.diagram.tables.find(t => t.id === tableId);
		if (!table) return;
		this.isDraggingTable = true;
		this.draggingTableId = tableId;
		this.dragStartMouseX = e.clientX;
		this.dragStartMouseY = e.clientY;
		this.dragStartTableX = table.x;
		this.dragStartTableY = table.y;
	}

	private startPan(e: MouseEvent): void {
		this.isPanning = true;
		this.panStartMouseX = e.clientX;
		this.panStartMouseY = e.clientY;
		this.panStartX = this.panX;
		this.panStartY = this.panY;
		this.canvasWrapper.classList.add("panning");
	}

	// ─── Relation drawing ──────────────────────────────────────────────────────

	private handleRelationFieldClick(tableId: number, fieldId: number): void {
		if (!this.isDrawingRelation) {
			this.relStartTableId = tableId;
			this.relStartFieldId = fieldId;
			this.isDrawingRelation = true;
			// Highlight the selected field
			this.canvas.querySelectorAll<HTMLElement>(".drawdb-field-row").forEach(el => {
				el.classList.toggle("rel-start",
					parseInt(el.dataset.fieldId ?? "0") === fieldId &&
					this.canvas.querySelector<HTMLElement>(`[data-table-id="${tableId}"]`)
						?.contains(el) === true
				);
			});
		} else {
			// Complete relation
			if (this.relStartTableId !== null && this.relStartFieldId !== null &&
				!(tableId === this.relStartTableId && fieldId === this.relStartFieldId)) {
				const ref: DrawDBReference = {
					id: this.nextId++,
					name: "",
					startTableId: this.relStartTableId,
					startFieldId: this.relStartFieldId,
					endTableId: tableId,
					endFieldId: fieldId,
					cardinality: "Many to one",
					updateBehavior: "No action",
					deleteBehavior: "No action",
				};
				this.diagram.references.push(ref);
				this.renderConnections();
				this.selectedRefId = ref.id;
				this.selectedTableId = null;
				this.selectedFieldId = null;
				this.renderPropertiesPanel();
				this.pushHistory();
				this.markDirty();
			}
			this.cancelRelationDrawing();
		}
	}

	private cancelRelationDrawing(): void {
		this.isDrawingRelation = false;
		this.relStartTableId = null;
		this.relStartFieldId = null;
		if (this.relTempLine) {
			this.relTempLine.remove();
			this.relTempLine = null;
		}
		this.canvas.querySelectorAll(".rel-start").forEach(el => el.classList.remove("rel-start"));
	}

	// ─── Zoom ──────────────────────────────────────────────────────────────────

	private setZoom(newScale: number, cx?: number, cy?: number): void {
		newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
		if (cx !== undefined && cy !== undefined) {
			const ratio = newScale / this.scale;
			this.panX = cx - ratio * (cx - this.panX);
			this.panY = cy - ratio * (cy - this.panY);
		}
		this.scale = newScale;
		this.updateCanvasTransform();
		this.renderConnections();
	}

	fitToScreen(): void {
		if (this.diagram.tables.length === 0) {
			this.panX = 40;
			this.panY = 40;
			this.scale = 1;
			this.updateCanvasTransform();
			return;
		}
		const pad = 40;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const t of this.diagram.tables) {
			minX = Math.min(minX, t.x);
			minY = Math.min(minY, t.y);
			maxX = Math.max(maxX, t.x + TABLE_WIDTH);
			maxY = Math.max(maxY, t.y + TABLE_HEADER_HEIGHT + t.fields.length * FIELD_HEIGHT);
		}
		const dw = maxX - minX;
		const dh = maxY - minY;
		const ww = this.canvasWrapper.clientWidth - pad * 2;
		const wh = this.canvasWrapper.clientHeight - pad * 2;
		this.scale = Math.max(MIN_SCALE, Math.min(1, ww / dw, wh / dh));
		this.panX = pad - minX * this.scale;
		this.panY = pad - minY * this.scale;
		this.updateCanvasTransform();
		this.renderConnections();
	}

	// ─── History ───────────────────────────────────────────────────────────────

	private pushHistory(): void {
		this.history = this.history.slice(0, this.historyIndex + 1);
		this.history.push(JSON.stringify(this.diagram));
		this.historyIndex = this.history.length - 1;
		this.updateHistoryButtons();
	}

	private undo(): void {
		if (this.historyIndex <= 0) return;
		this.historyIndex--;
		this.diagram = JSON.parse(this.history[this.historyIndex] ?? "{}") as DrawDBDiagram;
		this.render();
		this.renderPropertiesPanel();
		this.updateHistoryButtons();
		this.markDirty();
	}

	private redo(): void {
		if (this.historyIndex >= this.history.length - 1) return;
		this.historyIndex++;
		this.diagram = JSON.parse(this.history[this.historyIndex] ?? "{}") as DrawDBDiagram;
		this.render();
		this.renderPropertiesPanel();
		this.updateHistoryButtons();
		this.markDirty();
	}

	// ─── Save & Export ─────────────────────────────────────────────────────────

	private markDirty(): void {
		this.options.onDirty?.();
	}

	async save(): Promise<void> {
		this.pushHistory();
		await this.options.onSave?.(this.diagram);
	}

	private exportSQL(): void {
		const sql = this.generateSQL();
		const blob = new Blob([sql], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = activeDocument.createElement("a");
		a.href = url;
		a.download = "schema.sql";
		a.click();
		URL.revokeObjectURL(url);
	}

	private generateSQL(): string {
		const lines: string[] = [];
		const db = this.diagram.database;

		for (const table of this.diagram.tables) {
			if (table.comment) lines.push(`-- ${table.comment}`);
			lines.push(`CREATE TABLE \`${table.name}\` (`);
			const defs: string[] = [];
			const pks: string[] = [];

			for (const field of table.fields) {
				let typePart = field.size ? `${field.type}(${field.size})` : field.type;
				let def = `  \`${field.name}\` ${typePart}`;
				if (field.notnull) def += " NOT NULL";
				if (field.unique && !field.primary) def += " UNIQUE";
				if (field.default) def += ` DEFAULT ${field.default}`;
				if (field.autoincrement && (db === "MySQL" || db === "MariaDB")) def += " AUTO_INCREMENT";
				if (field.comment && (db === "MySQL" || db === "MariaDB")) def += ` COMMENT '${field.comment}'`;
				defs.push(def);
				if (field.primary) pks.push(`\`${field.name}\``);
			}
			if (pks.length > 0) defs.push(`  PRIMARY KEY (${pks.join(", ")})`);
			lines.push(defs.join(",\n"));
			lines.push(");\n");
		}

		for (const ref of this.diagram.references) {
			const sTable = this.diagram.tables.find(t => t.id === ref.startTableId);
			const eTable = this.diagram.tables.find(t => t.id === ref.endTableId);
			const sField = sTable?.fields.find(f => f.id === ref.startFieldId);
			const eField = eTable?.fields.find(f => f.id === ref.endFieldId);
			if (!sTable || !eTable || !sField || !eField) continue;
			const cname = ref.name || `fk_${sTable.name}_${eTable.name}_${sField.name}`;
			lines.push(`ALTER TABLE \`${sTable.name}\``);
			lines.push(`  ADD CONSTRAINT \`${cname}\``);
			lines.push(`  FOREIGN KEY (\`${sField.name}\`)`);
			lines.push(`  REFERENCES \`${eTable.name}\`(\`${eField.name}\`)`);
			lines.push(`  ON UPDATE ${ref.updateBehavior.toUpperCase().replace(/ /g, "_")}`);
			lines.push(`  ON DELETE ${ref.deleteBehavior.toUpperCase().replace(/ /g, "_")};\n`);
		}

		return lines.join("\n");
	}

	// ─── Events ────────────────────────────────────────────────────────────────

	private attachCanvasEvents(): void {
		// Wheel zoom
		this.canvasWrapper.addEventListener("wheel", (e: WheelEvent) => {
			e.preventDefault();
			const rect = this.canvasWrapper.getBoundingClientRect();
			const cx = e.clientX - rect.left;
			const cy = e.clientY - rect.top;
			const factor = e.deltaY < 0 ? 1.1 : 0.9;
			this.setZoom(this.scale * factor, cx, cy);
		}, { passive: false });

		// Middle mouse or space+drag to pan
		this.canvasWrapper.addEventListener("mousedown", (e: MouseEvent) => {
			if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
				e.preventDefault();
				this.startPan(e);
			}
		});

		// Deselect on background click
		this.canvasWrapper.addEventListener("click", (e: MouseEvent) => {
			if (e.target === this.canvasWrapper || e.target === this.canvas) {
				this.selectedTableId = null;
				this.selectedFieldId = null;
				this.selectedRefId = null;
				this.syncTableSelection();
				this.renderConnections();
				this.renderPropertiesPanel();
			}
		});

		// Double-click canvas to add table
		this.canvasWrapper.addEventListener("dblclick", (e: MouseEvent) => {
			if (e.target === this.canvasWrapper || e.target === this.canvas) {
				const rect = this.canvasWrapper.getBoundingClientRect();
				const x = (e.clientX - rect.left - this.panX) / this.scale;
				const y = (e.clientY - rect.top - this.panY) / this.scale;
				this.addTableAt(x, y);
			}
		});
	}

	private onMouseMove(e: MouseEvent): void {
		if (this.isDraggingTable && this.draggingTableId !== null) {
			const dx = (e.clientX - this.dragStartMouseX) / this.scale;
			const dy = (e.clientY - this.dragStartMouseY) / this.scale;
			const table = this.diagram.tables.find(t => t.id === this.draggingTableId);
			if (table) {
				table.x = Math.max(0, this.dragStartTableX + dx);
				table.y = Math.max(0, this.dragStartTableY + dy);
				const el = this.canvas.querySelector<HTMLElement>(`[data-table-id="${table.id}"]`);
				if (el) {
					el.style.left = table.x + "px";
					el.style.top = table.y + "px";
				}
				this.renderConnections();
			}
		} else if (this.isPanning) {
			this.panX = this.panStartX + (e.clientX - this.panStartMouseX);
			this.panY = this.panStartY + (e.clientY - this.panStartMouseY);
			this.updateCanvasTransform();
			this.renderConnections();
		} else if (this.isDrawingRelation && this.relStartTableId !== null && this.relStartFieldId !== null) {
			const rect = this.canvasWrapper.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;
			const st = this.diagram.tables.find(t => t.id === this.relStartTableId);
			if (st) {
				const sfIdx = st.fields.findIndex(f => f.id === this.relStartFieldId);
				const sx = (st.x + TABLE_WIDTH) * this.scale + this.panX;
				const sy = (st.y + TABLE_HEADER_HEIGHT + sfIdx * FIELD_HEIGHT + FIELD_HEIGHT / 2) * this.scale + this.panY;
				if (!this.relTempLine) {
					this.relTempLine = svgEl("path");
					this.relTempLine.classList.add("drawdb-relation", "drawdb-relation-temp");
					this.svgLayer.appendChild(this.relTempLine);
				}
				const cp = Math.max(Math.abs(mx - sx) / 2, 60);
				this.relTempLine.setAttribute("d", `M${sx},${sy} C${sx + cp},${sy} ${mx - cp},${my} ${mx},${my}`);
			}
		}
	}

	private onMouseUp(_e: MouseEvent): void {
		if (this.isDraggingTable) {
			this.isDraggingTable = false;
			if (this.draggingTableId !== null) {
				this.pushHistory();
				this.markDirty();
			}
			this.draggingTableId = null;
		}
		if (this.isPanning) {
			this.isPanning = false;
			this.canvasWrapper.classList.remove("panning");
		}
	}

	private onKeyDown(e: KeyboardEvent): void {
		const target = e.target as HTMLElement;
		const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";

		if (e.code === "Space" && !inInput) {
			e.preventDefault();
			this.spaceHeld = true;
			this.canvasWrapper.classList.add("grab-cursor");
		}
		if ((e.ctrlKey || e.metaKey) && e.key === "s") {
			e.preventDefault();
			void this.save();
		}
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") {
			e.preventDefault();
			this.undo();
		}
		if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === "z" || e.key === "y")) {
			e.preventDefault();
			this.redo();
		}
		if (e.key === "Escape") {
			this.cancelRelationDrawing();
			if (this.mode === "relation") this.setMode("select");
		}
		if ((e.key === "Delete" || e.key === "Backspace") && !inInput) {
			if (this.selectedTableId !== null) this.deleteTable(this.selectedTableId);
			else if (this.selectedRefId !== null) {
				this.diagram.references = this.diagram.references.filter(r => r.id !== this.selectedRefId);
				this.selectedRefId = null;
				this.renderConnections();
				this.renderPropertiesPanel();
				this.pushHistory();
				this.markDirty();
			}
		}
	}

	private onKeyUp(e: KeyboardEvent): void {
		if (e.code === "Space") {
			this.spaceHeld = false;
			this.canvasWrapper.classList.remove("grab-cursor");
		}
	}

	// ─── Helpers ───────────────────────────────────────────────────────────────

	private propRow(parent: HTMLElement, label: string, build: (row: HTMLElement) => void): void {
		const row = parent.createDiv({ cls: "drawdb-prop-row" });
		row.createEl("label", { cls: "drawdb-prop-label", text: label });
		const content = row.createDiv({ cls: "drawdb-prop-content" });
		build(content);
	}

	private propSelectRow(parent: HTMLElement, label: string, options: string[], current: string, onChange: (v: string) => void): void {
		this.propRow(parent, label, row => {
			const sel = row.createEl("select", { cls: "drawdb-prop-select" });
			options.forEach(opt => {
				const o = sel.createEl("option", { text: opt, value: opt });
				if (opt === current) o.selected = true;
			});
			sel.addEventListener("change", () => onChange(sel.value));
		});
	}
}
