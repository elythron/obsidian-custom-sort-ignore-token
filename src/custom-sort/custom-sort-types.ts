import {MDataExtractor} from "./mdata-extractors";

export enum CustomSortGroupType {
	Outsiders, // Not belonging to any of other groups
	MatchAll, // like a wildard *, used in connection with foldersOnly or filesOnly. The difference between the MatchAll and Outsiders is
	ExactName,                           // ... that MatchAll captures the item (folder, note) and prevents further matching against other rules
	ExactPrefix,						  // ... while the Outsiders captures items which didn't match any of other defined groups
	ExactSuffix,
	ExactHeadAndTail, // Like W...n or Un...ed, which is shorter variant of typing the entire title
	HasMetadataField,  // Notes (or folder's notes) containing a specific metadata field
	BookmarkedOnly,
	HasIcon
}

export enum CustomSortOrder {
	alphabetical = 1,  // = 1 to allow: if (customSortOrder) { ...
	alphabeticalWithFileExt,
	trueAlphabetical,
	trueAlphabeticalWithFileExt,
	alphabeticalReverse,
	alphabeticalReverseWithFileExt,
	trueAlphabeticalReverse,
	trueAlphabeticalReverseWithFileExt,
	byModifiedTime,   // New to old
	byModifiedTimeAdvanced,
	byModifiedTimeAdvancedRecursive,
	byModifiedTimeReverse,  // Old to new
	byModifiedTimeReverseAdvanced,
	byModifiedTimeReverseAdvancedRecursive,
	byCreatedTime,  // New to old
	byCreatedTimeAdvanced,
	byCreatedTimeAdvancedRecursive,
	byCreatedTimeReverse,
	byCreatedTimeReverseAdvanced,
	byCreatedTimeReverseAdvancedRecursive,
	byMetadataFieldAlphabetical,
	byMetadataFieldTrueAlphabetical,
	byMetadataFieldAlphabeticalReverse,
	byMetadataFieldTrueAlphabeticalReverse,
	standardObsidian,  // whatever user selected in the UI
	byBookmarkOrder,
	byBookmarkOrderReverse,
	fileFirst,
	folderFirst,
	alphabeticalWithFilesPreferred, // When the (base)names are equal, the file has precedence over a folder
	alphabeticalWithFoldersPreferred, // When the (base)names are equal, the file has precedence over a folder,
	vscUnicode, // the Visual Studio Code lexicographic order named 'unicode' (which is very misleading, at the same time familiar to VS Code users
	vscUnicodeReverse,         // ... see compareFilesUnicode function https://github.com/microsoft/vscode/blob/a19b2d5fb0202e00fb930dc850d2695ec512e495/src/vs/base/common/comparers.ts#L80
	default = alphabeticalWithFilesPreferred
}

export type NormalizerFn = (s: string) => string | null
export const IdentityNormalizerFn: NormalizerFn = (s: string) => s

export interface RegExpSpec {
	regex: RegExp
	normalizerFn?: NormalizerFn
}

export interface CustomSort {
	order: CustomSortOrder    // mandatory
	byMetadata?: string
	metadataValueExtractor?: MDataExtractor
}

export interface RecognizedSorting {
	primary?: CustomSort
	secondary?: CustomSort
}

export interface CustomSortGroup {
	type: CustomSortGroupType
	exactText?: string
	exactPrefix?: string
	regexPrefix?: RegExpSpec
	exactSuffix?: string
	regexSuffix?: RegExpSpec
	sorting?: CustomSort
	secondarySorting?: CustomSort
	filesOnly?: boolean
	matchFilenameWithExt?: boolean
	foldersOnly?: boolean
	withMetadataFieldName?: string // for 'with-metadata:' grouping
	iconName?: string // for integration with obsidian-folder-icon community plugin
	priority?: number
	combineWithIdx?: number
}

export interface CustomSortSpec {
		// plays only informative role about the original parsed 'target-folder:' values
	targetFoldersPaths: Array<string>   // For root use '/'
	defaultSorting?: CustomSort
	defaultSecondarySorting?: CustomSort
	groups: Array<CustomSortGroup>
	groupsShadow?: Array<CustomSortGroup>   // A shallow copy of groups, used at applying sorting for items in a folder.
	                                        // Stores folder-specific values (e.g. macros expanded with folder-specific values)
	outsidersGroupIdx?: number
	outsidersFilesGroupIdx?: number
	outsidersFoldersGroupIdx?: number
	itemsToHide?: Set<string>
	itemsToIgnore?: Set<string> // NEW
	priorityOrder?: Array<number>       // Indexes of groups in evaluation order
	implicit?: boolean // spec applied automatically (e.g. auto integration with a plugin)
}

export const DEFAULT_METADATA_FIELD_FOR_SORTING: string = 'sort-index-value'
