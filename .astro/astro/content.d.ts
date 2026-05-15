declare module 'astro:content' {
	interface RenderResult {
		Content: import('astro/runtime/server/index.js').AstroComponentFactory;
		headings: import('astro').MarkdownHeading[];
		remarkPluginFrontmatter: Record<string, any>;
	}
	interface Render {
		'.md': Promise<RenderResult>;
	}

	export interface RenderedContent {
		html: string;
		metadata?: {
			imagePaths: Array<string>;
			[key: string]: unknown;
		};
	}
}

declare module 'astro:content' {
	type Flatten<T> = T extends { [K: string]: infer U } ? U : never;

	export type CollectionKey = keyof AnyEntryMap;
	export type CollectionEntry<C extends CollectionKey> = Flatten<AnyEntryMap[C]>;

	export type ContentCollectionKey = keyof ContentEntryMap;
	export type DataCollectionKey = keyof DataEntryMap;

	type AllValuesOf<T> = T extends any ? T[keyof T] : never;
	type ValidContentEntrySlug<C extends keyof ContentEntryMap> = AllValuesOf<
		ContentEntryMap[C]
	>['slug'];

	/** @deprecated Use `getEntry` instead. */
	export function getEntryBySlug<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		// Note that this has to accept a regular string too, for SSR
		entrySlug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;

	/** @deprecated Use `getEntry` instead. */
	export function getDataEntryById<C extends keyof DataEntryMap, E extends keyof DataEntryMap[C]>(
		collection: C,
		entryId: E,
	): Promise<CollectionEntry<C>>;

	export function getCollection<C extends keyof AnyEntryMap, E extends CollectionEntry<C>>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => entry is E,
	): Promise<E[]>;
	export function getCollection<C extends keyof AnyEntryMap>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => unknown,
	): Promise<CollectionEntry<C>[]>;

	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(entry: {
		collection: C;
		slug: E;
	}): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(entry: {
		collection: C;
		id: E;
	}): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		slug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(
		collection: C,
		id: E,
	): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;

	/** Resolve an array of entry references from the same collection */
	export function getEntries<C extends keyof ContentEntryMap>(
		entries: {
			collection: C;
			slug: ValidContentEntrySlug<C>;
		}[],
	): Promise<CollectionEntry<C>[]>;
	export function getEntries<C extends keyof DataEntryMap>(
		entries: {
			collection: C;
			id: keyof DataEntryMap[C];
		}[],
	): Promise<CollectionEntry<C>[]>;

	export function render<C extends keyof AnyEntryMap>(
		entry: AnyEntryMap[C][string],
	): Promise<RenderResult>;

	export function reference<C extends keyof AnyEntryMap>(
		collection: C,
	): import('astro/zod').ZodEffects<
		import('astro/zod').ZodString,
		C extends keyof ContentEntryMap
			? {
					collection: C;
					slug: ValidContentEntrySlug<C>;
				}
			: {
					collection: C;
					id: keyof DataEntryMap[C];
				}
	>;
	// Allow generic `string` to avoid excessive type errors in the config
	// if `dev` is not running to update as you edit.
	// Invalid collection names will be caught at build time.
	export function reference<C extends string>(
		collection: C,
	): import('astro/zod').ZodEffects<import('astro/zod').ZodString, never>;

	type ReturnTypeOrOriginal<T> = T extends (...args: any[]) => infer R ? R : T;
	type InferEntrySchema<C extends keyof AnyEntryMap> = import('astro/zod').infer<
		ReturnTypeOrOriginal<Required<ContentConfig['collections'][C]>['schema']>
	>;

	type ContentEntryMap = {
		"manual": {
"01-you-made-it.md": {
	id: "01-you-made-it.md";
  slug: "01-you-made-it";
  body: string;
  collection: "manual";
  data: InferEntrySchema<"manual">
} & { render(): Render[".md"] };
"02-towels-water-keys.md": {
	id: "02-towels-water-keys.md";
  slug: "02-towels-water-keys";
  body: string;
  collection: "manual";
  data: InferEntrySchema<"manual">
} & { render(): Render[".md"] };
"03-wifi.md": {
	id: "03-wifi.md";
  slug: "03-wifi";
  body: string;
  collection: "manual";
  data: InferEntrySchema<"manual">
} & { render(): Render[".md"] };
"04-chromecast.md": {
	id: "04-chromecast.md";
  slug: "04-chromecast";
  body: string;
  collection: "manual";
  data: InferEntrySchema<"manual">
} & { render(): Render[".md"] };
"05-lights-and-fan.md": {
	id: "05-lights-and-fan.md";
  slug: "05-lights-and-fan";
  body: string;
  collection: "manual";
  data: InferEntrySchema<"manual">
} & { render(): Render[".md"] };
"06-music.md": {
	id: "06-music.md";
  slug: "06-music";
  body: string;
  collection: "manual";
  data: InferEntrySchema<"manual">
} & { render(): Render[".md"] };
"07-timers.md": {
	id: "07-timers.md";
  slug: "07-timers";
  body: string;
  collection: "manual";
  data: InferEntrySchema<"manual">
} & { render(): Render[".md"] };
"08-rivelia.md": {
	id: "08-rivelia.md";
  slug: "08-rivelia";
  body: string;
  collection: "manual";
  data: InferEntrySchema<"manual">
} & { render(): Render[".md"] };
"09-tovala.md": {
	id: "09-tovala.md";
  slug: "09-tovala";
  body: string;
  collection: "manual";
  data: InferEntrySchema<"manual">
} & { render(): Render[".md"] };
"10-building-amenities.md": {
	id: "10-building-amenities.md";
  slug: "10-building-amenities";
  body: string;
  collection: "manual";
  data: InferEntrySchema<"manual">
} & { render(): Render[".md"] };
"11-midtown.md": {
	id: "11-midtown.md";
  slug: "11-midtown";
  body: string;
  collection: "manual";
  data: InferEntrySchema<"manual">
} & { render(): Render[".md"] };
"12-make-yourself-at-home.md": {
	id: "12-make-yourself-at-home.md";
  slug: "12-make-yourself-at-home";
  body: string;
  collection: "manual";
  data: InferEntrySchema<"manual">
} & { render(): Render[".md"] };
};

	};

	type DataEntryMap = {
		
	};

	type AnyEntryMap = ContentEntryMap & DataEntryMap;

	export type ContentConfig = typeof import("../../src/content/config.js");
}
