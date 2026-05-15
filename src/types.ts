export interface DrawDBField {
	id: number;
	name: string;
	type: string;
	default: string;
	primary: boolean;
	unique: boolean;
	notnull: boolean;
	autoincrement: boolean;
	comment: string;
	size: string;
	check: string;
	values: string[];
}

export interface DrawDBIndex {
	id: number;
	name: string;
	unique: boolean;
	fields: number[];
}

export interface DrawDBTable {
	id: number;
	name: string;
	x: number;
	y: number;
	color: string;
	comment: string;
	fields: DrawDBField[];
	indices: DrawDBIndex[];
}

export interface DrawDBReference {
	id: number;
	name: string;
	startTableId: number;
	startFieldId: number;
	endTableId: number;
	endFieldId: number;
	cardinality: string;
	updateBehavior: string;
	deleteBehavior: string;
}

export interface DrawDBNote {
	id: number;
	x: number;
	y: number;
	title: string;
	content: string;
	color: string;
}

export interface DrawDBArea {
	id: number;
	x: number;
	y: number;
	width: number;
	height: number;
	name: string;
	color: string;
}

export interface DrawDBDiagram {
	database: string;
	tables: DrawDBTable[];
	references: DrawDBReference[];
	notes: DrawDBNote[];
	areas: DrawDBArea[];
}

export const FIELD_TYPES_MYSQL = [
	"INT", "BIGINT", "SMALLINT", "TINYINT", "MEDIUMINT",
	"DECIMAL", "FLOAT", "DOUBLE", "NUMERIC",
	"VARCHAR", "CHAR", "TEXT", "LONGTEXT", "MEDIUMTEXT", "TINYTEXT",
	"DATE", "DATETIME", "TIMESTAMP", "TIME", "YEAR",
	"BOOLEAN", "BIT",
	"ENUM", "SET",
	"JSON", "BLOB", "MEDIUMBLOB", "LONGBLOB", "BINARY", "VARBINARY",
];

export const FIELD_TYPES_POSTGRES = [
	"INTEGER", "BIGINT", "SMALLINT", "SERIAL", "BIGSERIAL",
	"DECIMAL", "NUMERIC", "REAL", "DOUBLE PRECISION",
	"VARCHAR", "CHAR", "TEXT",
	"DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ", "INTERVAL",
	"BOOLEAN",
	"JSON", "JSONB",
	"UUID", "BYTEA", "INET", "CIDR", "MACADDR",
];

export const FIELD_TYPES_SQLITE = [
	"INTEGER", "REAL", "TEXT", "BLOB", "NUMERIC",
];

export const FIELD_TYPES_MSSQL = [
	"INT", "BIGINT", "SMALLINT", "TINYINT",
	"DECIMAL", "FLOAT", "REAL", "MONEY", "SMALLMONEY",
	"VARCHAR", "NVARCHAR", "CHAR", "NCHAR", "TEXT", "NTEXT",
	"DATE", "DATETIME", "DATETIME2", "SMALLDATETIME", "TIME",
	"BIT", "BINARY", "VARBINARY",
	"UNIQUEIDENTIFIER", "XML",
];

export const DATABASE_TYPES = ["MySQL", "PostgreSQL", "SQLite", "MSSQL", "MariaDB"];

export const TABLE_COLORS = [
	"#175e7a", "#2d6a4f", "#6b2d8b", "#c05621",
	"#2c5282", "#7d3c98", "#1a535c", "#c0392b",
	"#16a085", "#8e44ad", "#2980b9", "#d35400",
	"#1abc9c", "#e74c3c", "#3498db", "#9b59b6",
];

export const CARDINALITY_TYPES = [
	"Many to one",
	"One to one",
	"Many to many",
	"One to many",
];

export const CONSTRAINT_BEHAVIORS = [
	"No action",
	"Cascade",
	"Set null",
	"Restrict",
	"Set default",
];

export function getFieldTypes(database: string): string[] {
	switch (database) {
		case "PostgreSQL": return FIELD_TYPES_POSTGRES;
		case "SQLite": return FIELD_TYPES_SQLITE;
		case "MSSQL": return FIELD_TYPES_MSSQL;
		default: return FIELD_TYPES_MYSQL;
	}
}

export function createDefaultField(id: number): DrawDBField {
	return {
		id,
		name: "field_" + id,
		type: "VARCHAR",
		default: "",
		primary: false,
		unique: false,
		notnull: false,
		autoincrement: false,
		comment: "",
		size: "",
		check: "",
		values: [],
	};
}
