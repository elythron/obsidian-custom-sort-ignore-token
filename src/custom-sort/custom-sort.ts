import {
	FrontMatterCache,
	MetadataCache,
	TAbstractFile,
	TFile,
	TFolder,
	Vault
} from 'obsidian';
import {
	determineIconOf,
	ObsidianIconFolder_PluginInstance
} from '../utils/ObsidianIconFolderPluginSignature'
import {
	CustomSort,
	CustomSortGroup,
	CustomSortGroupType,
	CustomSortOrder,
	CustomSortSpec,
	DEFAULT_METADATA_FIELD_FOR_SORTING,
	NormalizerFn,
	RegExpSpec
} from "./custom-sort-types";
import {
	isDefined
} from "../utils/utils";
import {
	expandMacros
} from "./macros";
import {
	BookmarksPluginInterface
} from "../utils/BookmarksCorePluginSignature";
import {CustomSortPluginAPI} from "../custom-sort-plugin";
import {MDataExtractor} from "./mdata-extractors";

export interface ProcessingContext {
	// For internal transient use
	plugin?: CustomSortPluginAPI                     // to hand over the access to App instance to the sorting engine
	_mCache?: MetadataCache
	bookmarksPluginInstance?: BookmarksPluginInterface,
	iconFolderPluginInstance?: ObsidianIconFolder_PluginInstance
}

export const CollatorCompare = new Intl.Collator(undefined, {
	usage: "sort",
	sensitivity: "base",
	numeric: true,
}).compare;

export const CollatorTrueAlphabeticalCompare = new Intl.Collator(undefined, {
	usage: "sort",
	sensitivity: "base",
	numeric: false,
}).compare;

export interface FolderItemForSorting {
	path: string
	groupIdx?: number  // the index itself represents order for groups
	sortString: string // file basename / folder name to be used for sorting (optionally prefixed with regexp-matched group)
	sortStringWithExt: string // same as above, yet full filename (with ext)
	metadataFieldValue?: string // relevant to metadata-based group sorting only
	metadataFieldValueSecondary?: string // relevant to secondary metadata-based sorting only
	metadataFieldValueForDerived?: string // relevant to metadata-based sorting-spec level sorting only
	metadataFieldValueForDerivedSecondary?: string // relevant to metadata-based sorting-spec level secondary sorting only
	ctime: number   // for a file ctime is obvious, for a folder = ctime of the oldest child file
	mtime: number   // for a file mtime is obvious, for a folder = date of most recently modified child file
	isFolder: boolean
	folder?: TFolder
	bookmarkedIdx?: number // derived from Bookmarks core plugin position
}

export enum SortingLevelId {
	forPrimary,
	forSecondary,
	forDerivedPrimary,
	forDerivedSecondary,
	forDefaultWhenUnspecified
}

export type SorterFn = (a: FolderItemForSorting, b: FolderItemForSorting) => number
export type PlainSorterFn = (a: TAbstractFile, b: TAbstractFile) => number
export type PlainFileOnlySorterFn = (a: TFile, b: TFile) => number
export type CollatorCompareFn = (a: string, b: string) => number

// Syntax sugar
const TrueAlphabetical: boolean = true
const ReverseOrder: boolean = true
const StraightOrder: boolean = false

export const EQUAL_OR_UNCOMPARABLE: number = 0

export const getMdata = (it: FolderItemForSorting, mdataId?: SortingLevelId) => {
	switch (mdataId) {
		case SortingLevelId.forSecondary: return it.metadataFieldValueSecondary
		case SortingLevelId.forDerivedPrimary: return it.metadataFieldValueForDerived
		case SortingLevelId.forDerivedSecondary: return it.metadataFieldValueForDerivedSecondary
		case SortingLevelId.forPrimary:
		default: return it.metadataFieldValue
	}
}

export const sorterByMetadataField = (reverseOrder?: boolean, trueAlphabetical?: boolean, sortLevelId?: SortingLevelId): SorterFn => {
	const collatorCompareFn: CollatorCompareFn = trueAlphabetical ? CollatorTrueAlphabeticalCompare : CollatorCompare
	return (a: FolderItemForSorting, b: FolderItemForSorting) => {
		let [amdata, bmdata] = [getMdata(a, sortLevelId), getMdata(b, sortLevelId)]
		if (reverseOrder) {
			[amdata, bmdata] = [bmdata, amdata]
		}
		if (amdata!==undefined && bmdata!==undefined) {
			const sortResult: number = collatorCompareFn(amdata, bmdata)
			return sortResult
		}
		// Item with metadata goes before the w/o metadata
		if (amdata!==undefined) return reverseOrder ? 1 : -1
		if (bmdata!==undefined) return reverseOrder ? -1 : 1

		return EQUAL_OR_UNCOMPARABLE
	}
}

export const sorterByBookmarkOrder:(reverseOrder?: boolean, trueAlphabetical?: boolean) => SorterFn = (reverseOrder: boolean) => {
	return (a: FolderItemForSorting, b: FolderItemForSorting) => {
		if (reverseOrder) {
			[a, b] = [b, a]
		}
		if (a.bookmarkedIdx && b.bookmarkedIdx) {
			// By design the bookmark idx is unique per each item, so no need for secondary sorting if they are equal
			return a.bookmarkedIdx - b.bookmarkedIdx
		}
		// Item with bookmark order goes before the w/o bookmark info
		if (a.bookmarkedIdx) return reverseOrder ? 1 : -1
		if (b.bookmarkedIdx) return reverseOrder ? -1 : 1

		return EQUAL_OR_UNCOMPARABLE
	}
}

export const sorterByFolderCDate:(reverseOrder?: boolean) => SorterFn = (reverseOrder?: boolean) => {
	return (a: FolderItemForSorting, b: FolderItemForSorting) => {
		if (reverseOrder) {
			[a, b] = [b, a]
		}
		if (a.ctime && b.ctime) {
			return a.ctime - b.ctime
		}
		// Folder with determined ctime always goes before empty folder (=> undetermined ctime)
		if (a.ctime) return reverseOrder ? 1 : -1
		if (b.ctime) return reverseOrder ? -1 : 1

		return EQUAL_OR_UNCOMPARABLE
	}
}

export const sorterByFolderMDate:(reverseOrder?: boolean) => SorterFn = (reverseOrder?: boolean) => {
	return (a: FolderItemForSorting, b: FolderItemForSorting) => {
		if (reverseOrder) {
			[a, b] = [b, a]
		}
		if (a.mtime && b.mtime) {
			return a.mtime - b.mtime
		}
		// Folder with determined mtime always goes before empty folder (=> undetermined ctime)
		if (a.mtime) return reverseOrder ? 1 : -1
		if (b.mtime) return reverseOrder ? -1 : 1

		return EQUAL_OR_UNCOMPARABLE
	}
}

type FIFS = FolderItemForSorting

const fileGoesFirstWhenSameBasenameAsFolder = (stringCompareResult: number, a: FIFS, b: FIFS) =>
	(!!stringCompareResult) ? stringCompareResult : (a.isFolder === b.isFolder ? EQUAL_OR_UNCOMPARABLE : (a.isFolder ? 1 : -1) );

const folderGoesFirstWhenSameBasenameAsFolder = (stringCompareResult: number, a: FIFS, b: FIFS) =>
	(!!stringCompareResult) ? stringCompareResult : (a.isFolder === b.isFolder ? EQUAL_OR_UNCOMPARABLE : (a.isFolder ? -1 : 1) );

const Sorters: { [key in CustomSortOrder]: SorterFn } = {
	[CustomSortOrder.alphabetical]: (a: FIFS, b: FIFS) => CollatorCompare(a.sortString, b.sortString),
	[CustomSortOrder.alphabeticalWithFilesPreferred]: (a: FIFS, b: FIFS) => fileGoesFirstWhenSameBasenameAsFolder(CollatorCompare(a.sortString, b.sortString),a,b),
	[CustomSortOrder.alphabeticalWithFoldersPreferred]: (a: FIFS, b: FIFS) => fileGoesFirstWhenSameBasenameAsFolder(CollatorCompare(a.sortString, b.sortString),a,b),
	[CustomSortOrder.alphabeticalWithFileExt]: (a: FIFS, b: FIFS) => CollatorCompare(a.sortStringWithExt, b.sortStringWithExt),
	[CustomSortOrder.trueAlphabetical]: (a: FIFS, b: FIFS) => CollatorTrueAlphabeticalCompare(a.sortString, b.sortString),
	[CustomSortOrder.trueAlphabeticalWithFileExt]: (a: FIFS, b: FIFS) => CollatorTrueAlphabeticalCompare(a.sortStringWithExt, b.sortStringWithExt),
	[CustomSortOrder.alphabeticalReverse]: (a: FIFS, b: FIFS) => CollatorCompare(b.sortString, a.sortString),
	[CustomSortOrder.alphabeticalReverseWithFileExt]: (a: FIFS, b: FIFS) => CollatorCompare(b.sortStringWithExt, a.sortStringWithExt),
	[CustomSortOrder.trueAlphabeticalReverse]: (a: FIFS, b: FIFS) => CollatorTrueAlphabeticalCompare(b.sortString, a.sortString),
	[CustomSortOrder.trueAlphabeticalReverseWithFileExt]: (a: FIFS, b: FIFS) => CollatorTrueAlphabeticalCompare(b.sortStringWithExt, a.sortStringWithExt),
	[CustomSortOrder.byModifiedTime]: (a: FIFS, b: FIFS) => (a.isFolder && b.isFolder) ? CollatorCompare(a.sortString, b.sortString) : (a.mtime - b.mtime),
	[CustomSortOrder.byModifiedTimeAdvanced]: sorterByFolderMDate(),
	[CustomSortOrder.byModifiedTimeAdvancedRecursive]: sorterByFolderMDate(),
	[CustomSortOrder.byModifiedTimeReverse]: (a: FIFS, b: FIFS) => (a.isFolder && b.isFolder) ? CollatorCompare(a.sortString, b.sortString) : (b.mtime - a.mtime),
	[CustomSortOrder.byModifiedTimeReverseAdvanced]: sorterByFolderMDate(true),
	[CustomSortOrder.byModifiedTimeReverseAdvancedRecursive]: sorterByFolderMDate(true),
	[CustomSortOrder.byCreatedTime]: (a: FIFS, b: FIFS) => (a.isFolder && b.isFolder) ? CollatorCompare(a.sortString, b.sortString) : (a.ctime - b.ctime),
	[CustomSortOrder.byCreatedTimeAdvanced]: sorterByFolderCDate(),
	[CustomSortOrder.byCreatedTimeAdvancedRecursive]: sorterByFolderCDate(),
	[CustomSortOrder.byCreatedTimeReverse]: (a: FIFS, b: FIFS) => (a.isFolder && b.isFolder) ? CollatorCompare(a.sortString, b.sortString) : (b.ctime - a.ctime),
	[CustomSortOrder.byCreatedTimeReverseAdvanced]: sorterByFolderCDate(true),
	[CustomSortOrder.byCreatedTimeReverseAdvancedRecursive]: sorterByFolderCDate(true),
	[CustomSortOrder.byMetadataFieldAlphabetical]: sorterByMetadataField(StraightOrder, !TrueAlphabetical, SortingLevelId.forPrimary),
	[CustomSortOrder.byMetadataFieldTrueAlphabetical]: sorterByMetadataField(StraightOrder, TrueAlphabetical, SortingLevelId.forPrimary),
	[CustomSortOrder.byMetadataFieldAlphabeticalReverse]: sorterByMetadataField(ReverseOrder, !TrueAlphabetical, SortingLevelId.forPrimary),
	[CustomSortOrder.byMetadataFieldTrueAlphabeticalReverse]: sorterByMetadataField(ReverseOrder, TrueAlphabetical, SortingLevelId.forPrimary),
	[CustomSortOrder.byBookmarkOrder]: sorterByBookmarkOrder(StraightOrder),
	[CustomSortOrder.byBookmarkOrderReverse]: sorterByBookmarkOrder(ReverseOrder),
	[CustomSortOrder.fileFirst]: (a: FIFS, b: FIFS) => (a.isFolder === b.isFolder) ? EQUAL_OR_UNCOMPARABLE : (a.isFolder ? 1 : -1),
	[CustomSortOrder.folderFirst]: (a: FIFS, b: FIFS) => (a.isFolder === b.isFolder) ? EQUAL_OR_UNCOMPARABLE : (a.isFolder ? -1 : 1),
	[CustomSortOrder.vscUnicode]: (a: FIFS, b: FIFS) => (a.sortString === b.sortString) ? EQUAL_OR_UNCOMPARABLE : (a.sortString < b.sortString ? -1 : 1),
	[CustomSortOrder.vscUnicodeReverse]: (a: FIFS, b: FIFS) => (a.sortString === b.sortString) ? EQUAL_OR_UNCOMPARABLE : (b.sortString < a.sortString ? -1 : 1),

	// A fallback entry which should not be used - the getSorterFor() function below should protect against it
	[CustomSortOrder.standardObsidian]: (a: FIFS, b: FIFS) => CollatorCompare(a.sortString, b.sortString),
};

// Some sorters are different when used in primary vs. secondary sorting order
const SortersForSecondary: { [key in CustomSortOrder]?: SorterFn } = {
	[CustomSortOrder.byMetadataFieldAlphabetical]: sorterByMetadataField(StraightOrder, !TrueAlphabetical, SortingLevelId.forSecondary),
	[CustomSortOrder.byMetadataFieldTrueAlphabetical]: sorterByMetadataField(StraightOrder, TrueAlphabetical, SortingLevelId.forSecondary),
	[CustomSortOrder.byMetadataFieldAlphabeticalReverse]: sorterByMetadataField(ReverseOrder, !TrueAlphabetical, SortingLevelId.forSecondary),
	[CustomSortOrder.byMetadataFieldTrueAlphabeticalReverse]: sorterByMetadataField(ReverseOrder, TrueAlphabetical, SortingLevelId.forSecondary)
};

const SortersForDerivedPrimary: { [key in CustomSortOrder]?: SorterFn } = {
	[CustomSortOrder.byMetadataFieldAlphabetical]: sorterByMetadataField(StraightOrder, !TrueAlphabetical, SortingLevelId.forDerivedPrimary),
	[CustomSortOrder.byMetadataFieldTrueAlphabetical]: sorterByMetadataField(StraightOrder, TrueAlphabetical, SortingLevelId.forDerivedPrimary),
	[CustomSortOrder.byMetadataFieldAlphabeticalReverse]: sorterByMetadataField(ReverseOrder, !TrueAlphabetical, SortingLevelId.forDerivedPrimary),
	[CustomSortOrder.byMetadataFieldTrueAlphabeticalReverse]: sorterByMetadataField(ReverseOrder, TrueAlphabetical, SortingLevelId.forDerivedPrimary)
};

const SortersForDerivedSecondary: { [key in CustomSortOrder]?: SorterFn } = {
	[CustomSortOrder.byMetadataFieldAlphabetical]: sorterByMetadataField(StraightOrder, !TrueAlphabetical, SortingLevelId.forDerivedSecondary),
	[CustomSortOrder.byMetadataFieldTrueAlphabetical]: sorterByMetadataField(StraightOrder, TrueAlphabetical, SortingLevelId.forDerivedSecondary),
	[CustomSortOrder.byMetadataFieldAlphabeticalReverse]: sorterByMetadataField(ReverseOrder, !TrueAlphabetical, SortingLevelId.forDerivedSecondary),
	[CustomSortOrder.byMetadataFieldTrueAlphabeticalReverse]: sorterByMetadataField(ReverseOrder, TrueAlphabetical, SortingLevelId.forDerivedSecondary)
};

// OS - Obsidian Sort
export const OS_alphabetical = 'alphabetical'
const OS_alphabeticalReverse = 'alphabeticalReverse'
export const OS_byModifiedTime = 'byModifiedTime'
export const OS_byModifiedTimeReverse = 'byModifiedTimeReverse'
export const OS_byCreatedTime = 'byCreatedTime'
const OS_byCreatedTimeReverse = 'byCreatedTimeReverse'

export const ObsidianStandardDefaultSortingName = OS_alphabetical

const StandardObsidianToCustomSort: {[key: string]: CustomSortOrder} = {
	[OS_alphabetical]: CustomSortOrder.alphabetical,
	[OS_alphabeticalReverse]: CustomSortOrder.alphabeticalReverse,
	[OS_byModifiedTime]: CustomSortOrder.byModifiedTimeReverse,     // In Obsidian labeled as 'Modified time (new to old)'
	[OS_byModifiedTimeReverse]: CustomSortOrder.byModifiedTime,     // In Obsidian labeled as 'Modified time (old to new)'
	[OS_byCreatedTime]: CustomSortOrder.byCreatedTimeReverse,       // In Obsidian labeled as 'Created time (new to old)'
	[OS_byCreatedTimeReverse]: CustomSortOrder.byCreatedTime        // In Obsidian labeled as 'Created time (old to new)'
}

const StandardObsidianToPlainSortFn: {[key: string]: PlainFileOnlySorterFn} = {
	[OS_alphabetical]: (a: TFile, b: TFile) => CollatorCompare(a.basename, b.basename),
	[OS_alphabeticalReverse]: (a: TFile, b: TFile) => -StandardObsidianToPlainSortFn[OS_alphabetical](a,b),
	[OS_byModifiedTime]: (a: TFile, b: TFile) => b.stat.mtime - a.stat.mtime,
	[OS_byModifiedTimeReverse]: (a: TFile, b: TFile) => -StandardObsidianToPlainSortFn[OS_byModifiedTime](a,b),
	[OS_byCreatedTime]: (a: TFile, b: TFile) => b.stat.ctime - a.stat.ctime,
	[OS_byCreatedTimeReverse]: (a: TFile, b: TFile) => -StandardObsidianToPlainSortFn[OS_byCreatedTime](a,b)
}

// Standard Obsidian comparator keeps folders in the top sorted alphabetically
const StandardObsidianComparator = (order: CustomSortOrder): SorterFn => {
	const customSorterFn = Sorters[order]
	return (a: FolderItemForSorting, b: FolderItemForSorting): number => {
		return a.isFolder || b.isFolder
			?
			(a.isFolder && !b.isFolder ? -1 : (b.isFolder && !a.isFolder ? 1 : Sorters[CustomSortOrder.alphabetical](a,b)))
			:
			customSorterFn(a, b);
	}
}

// Equivalent of StandardObsidianComparator working directly on TAbstractFile items
export const StandardPlainObsidianComparator = (order: string): PlainSorterFn => {
	const fileSorterFn = StandardObsidianToPlainSortFn[order] || StandardObsidianToCustomSort[OS_alphabetical]
	return (a: TAbstractFile, b: TAbstractFile): number => {
		const aIsFolder: boolean = a instanceof TFolder
		const bIsFolder: boolean = b instanceof TFolder
		return aIsFolder || bIsFolder
			?
			(aIsFolder && !bIsFolder ? -1 : (bIsFolder && !aIsFolder ? 1 : CollatorCompare(a.name,b.name)))
			:
			fileSorterFn(a as TFile, b as TFile);
	}
}

export const getSorterFnFor = (order: CustomSortOrder, currentUIselectedSorting?: string, sortLevelId?: SortingLevelId): SorterFn => {
	if (order === CustomSortOrder.standardObsidian) {
		order = StandardObsidianToCustomSort[currentUIselectedSorting ?? 'alphabetical'] ?? CustomSortOrder.alphabetical
		return StandardObsidianComparator(order)
	} else {
		// Some sorters have to know at which sorting level they are used
		switch(sortLevelId) {
			case SortingLevelId.forSecondary: return SortersForSecondary[order] ?? Sorters[order]
			case SortingLevelId.forDerivedPrimary: return SortersForDerivedPrimary[order] ?? Sorters[order]
			case SortingLevelId.forDerivedSecondary: return SortersForDerivedSecondary[order] ?? Sorters[order]
			case SortingLevelId.forPrimary:
			default: return Sorters[order]
		}
	}
}

export const getComparator = (sortSpec: CustomSortSpec, currentUIselectedSorting?: string): SorterFn => {
	const compareTwoItems = (itA: FolderItemForSorting, itB: FolderItemForSorting) => {
		if (itA.groupIdx != undefined && itB.groupIdx != undefined) {
			if (itA.groupIdx === itB.groupIdx) {
				const group: CustomSortGroup | undefined = sortSpec.groups[itA.groupIdx]
				const primary: number = group?.sorting ? getSorterFnFor(group.sorting.order, currentUIselectedSorting, SortingLevelId.forPrimary)(itA, itB) : EQUAL_OR_UNCOMPARABLE
				if (primary !== EQUAL_OR_UNCOMPARABLE) return primary
				const secondary: number = group?.secondarySorting ? getSorterFnFor(group.secondarySorting.order, currentUIselectedSorting, SortingLevelId.forSecondary)(itA, itB) : EQUAL_OR_UNCOMPARABLE
				if (secondary !== EQUAL_OR_UNCOMPARABLE) return secondary
				const folderLevel: number = sortSpec.defaultSorting ? getSorterFnFor(sortSpec.defaultSorting.order, currentUIselectedSorting, SortingLevelId.forDerivedPrimary)(itA, itB) : EQUAL_OR_UNCOMPARABLE
				if (folderLevel !== EQUAL_OR_UNCOMPARABLE) return folderLevel
				const folderLevelSecondary: number = sortSpec.defaultSecondarySorting ? getSorterFnFor(sortSpec.defaultSecondarySorting.order, currentUIselectedSorting, SortingLevelId.forDerivedSecondary)(itA, itB) : EQUAL_OR_UNCOMPARABLE
				if (folderLevelSecondary !== EQUAL_OR_UNCOMPARABLE) return folderLevelSecondary
				const defaultForUnspecified: number = getSorterFnFor(CustomSortOrder.default, undefined, SortingLevelId.forDefaultWhenUnspecified)(itA, itB)
				return defaultForUnspecified
			} else {
				return itA.groupIdx - itB.groupIdx;
			}
		} else {
			// should never happen - groupIdx is not known for at least one of items to compare.
			// The logic of determining the index always sets some idx
			// Yet for sanity and to satisfy TS code analyzer some valid behavior below
			if (itA.groupIdx !== undefined) return -1
			if (itB.groupIdx !== undefined) return 1
			return getSorterFnFor(CustomSortOrder.default, currentUIselectedSorting)(itA, itB)
		}
	}
	return compareTwoItems
}

const isFolder = (entry: TAbstractFile) => {
	// The plain obvious 'entry instanceof TFolder' doesn't work inside Jest unit tests, hence a workaround below
	return !!((entry as any).isRoot);
}

const isByMetadata = (order: CustomSortOrder | undefined) => {
	return order === CustomSortOrder.byMetadataFieldAlphabetical || order === CustomSortOrder.byMetadataFieldAlphabeticalReverse ||
	       order === CustomSortOrder.byMetadataFieldTrueAlphabetical || order === CustomSortOrder.byMetadataFieldTrueAlphabeticalReverse
}

// IMPORTANT: do not change the value of below constants
//    It is used in sorter to discern empty folders (thus undetermined dates) from other folders
export const DEFAULT_FOLDER_MTIME: number = 0
export const DEFAULT_FOLDER_CTIME: number = 0

type RegexMatchedGroup = string | undefined
type RegexFullMatch = string | undefined
type Matched = boolean

export const matchGroupRegex = (theRegex: RegExpSpec, nameForMatching: string): [Matched, RegexMatchedGroup, RegexFullMatch] => {
	const match: RegExpMatchArray | null | undefined = theRegex.regex.exec(nameForMatching);
	if (match) {
		const normalizer: NormalizerFn | undefined = theRegex.normalizerFn
		const regexMatchedGroup: string | undefined = match[1]
		if (regexMatchedGroup) {
			return [true, normalizer ? normalizer!(regexMatchedGroup)! : regexMatchedGroup, match[0]]
		} else {
			return [true, undefined, match[0]]
		}
	}
	return [false, undefined, undefined]
}

const mdataValueFromFMCaches = (mdataFieldName: string, mdataExtractor?: MDataExtractor, fc?: FrontMatterCache, fcPrio?: FrontMatterCache): any => {
	let prioValue = undefined
	if (fcPrio) {
		prioValue = fcPrio?.[mdataFieldName]
	}

	const rawMDataValue = prioValue ?? fc?.[mdataFieldName]
	return mdataExtractor ? mdataExtractor(rawMDataValue) : rawMDataValue
}

export const determineSortingGroup = function (entry: TFile | TFolder, spec: CustomSortSpec, ctx?: ProcessingContext): FolderItemForSorting {
	let groupIdx: number
	let determined: boolean = false
	let derivedText: string | null | undefined
	let derivedTextWithExt: string | undefined
	let bookmarkedIdx: number | undefined

	const aFolder: boolean = isFolder(entry)
	const aFile: boolean = !aFolder
	const entryAsTFile: TFile = entry as TFile
	const basename: string = aFolder ? entry.name : entryAsTFile.basename

	// When priorities come in play, the ordered list of groups to check could be shorter
	//    than the actual full set of defined groups, because the outsiders group are not
	//    in the ordered list (aka priorityOrder array)
	const numOfGroupsToCheck: number = spec.priorityOrder ? spec.priorityOrder.length : spec.groups.length
	for (let idx = 0; idx < numOfGroupsToCheck && !determined; idx++) {
		derivedText = null
		groupIdx = spec.priorityOrder ? spec.priorityOrder[idx] : idx
		const group: CustomSortGroup = spec.groupsShadow ? spec.groupsShadow[groupIdx] : spec.groups[groupIdx];
		if (group.foldersOnly && aFile) continue;
		if (group.filesOnly && aFolder) continue;
		const nameForMatching: string = group.matchFilenameWithExt ? entry.name : basename;
		switch (group.type) {
			case CustomSortGroupType.ExactPrefix:
				if (group.exactPrefix) {
					if (nameForMatching.startsWith(group.exactPrefix)) {
						determined = true;
					}
				} else { // regexp is involved
					const [matched, matchedGroup] = matchGroupRegex(group.regexPrefix!, nameForMatching)
					determined = matched
					derivedText = matchedGroup ?? derivedText
				}
				break;
			case CustomSortGroupType.ExactSuffix:
				if (group.exactSuffix) {
					if (nameForMatching.endsWith(group.exactSuffix)) {
						determined = true;
					}
				} else { // regexp is involved
					const [matched, matchedGroup] = matchGroupRegex(group.regexSuffix!, nameForMatching)
					determined = matched
					derivedText = matchedGroup ?? derivedText
				}
				break;
			case CustomSortGroupType.ExactHeadAndTail:
				if (group.exactPrefix && group.exactSuffix) {
					if (nameForMatching.length >= group.exactPrefix.length + group.exactSuffix.length) {
						if (nameForMatching.startsWith(group.exactPrefix) && nameForMatching.endsWith(group.exactSuffix)) {
							determined = true;
						}
					}
				} else if (group.exactPrefix || group.exactSuffix) { // regexp is involved as the prefix or as the suffix (not both)
					if ((group.exactPrefix && nameForMatching.startsWith(group.exactPrefix)) ||
						(group.exactSuffix && nameForMatching.endsWith(group.exactSuffix))) {
						const [matched, matchedGroup, fullMatch] = matchGroupRegex(group.exactPrefix ? group.regexSuffix! : group.regexPrefix!, nameForMatching)
						if (matched) {
							// check for overlapping of prefix and suffix match (not allowed)
							if ((fullMatch!.length + (group.exactPrefix?.length ?? 0) + (group.exactSuffix?.length ?? 0)) <= nameForMatching.length) {
								determined = true
								derivedText = matchedGroup ?? derivedText
							}
						}
					}
				} else { // regexp is involved both as the prefix and as the suffix
					const [matchedLeft, matchedGroupLeft, fullMatchLeft] = matchGroupRegex(group.regexPrefix!, nameForMatching)
					const [matchedRight, matchedGroupRight, fullMatchRight] = matchGroupRegex(group.regexSuffix!, nameForMatching)
					if (matchedLeft && matchedRight) {
						// check for overlapping of prefix and suffix match (not allowed)
						if ((fullMatchLeft!.length + fullMatchRight!.length) <= nameForMatching.length) {
							determined = true
							if (matchedGroupLeft || matchedGroupRight) {
								derivedText = ((matchedGroupLeft || '') + (matchedGroupRight || '')) || derivedText
							}
						}
					}
			}
				break;
			case CustomSortGroupType.ExactName:
				if (group.exactText) {
					if (nameForMatching === group.exactText) {
						determined = true;
					}
				} else { // regexp is involved
					const [matched, matchedGroup] = matchGroupRegex(group.regexPrefix!, nameForMatching)
					if (matched) {
						determined = true
						derivedText = matchedGroup ?? derivedText
					}
				}
				break
			case CustomSortGroupType.HasMetadataField:
				if (group.withMetadataFieldName) {
					if (ctx?._mCache) {
						// For folders - scan metadata of 'folder note' in same-name-as-parent-folder mode
						const notePathToScan: string = aFile ? entry.path : `${entry.path}/${entry.name}.md`
						let frontMatterCache: FrontMatterCache | undefined = ctx._mCache.getCache(notePathToScan)?.frontmatter
						let hasMetadata: boolean | undefined = frontMatterCache?.hasOwnProperty(group.withMetadataFieldName)
						// For folders, if index-based folder note mode, scan the index file, giving it the priority
						if (aFolder) {
							const indexNoteBasename = ctx?.plugin?.indexNoteBasename()
							if (indexNoteBasename) {
								frontMatterCache = ctx._mCache.getCache(`${entry.path}/${indexNoteBasename}.md`)?.frontmatter
								hasMetadata = hasMetadata || frontMatterCache?.hasOwnProperty(group.withMetadataFieldName)
							}
						}

						if (hasMetadata) {
							determined = true
						}
					}
				}
				break
			case CustomSortGroupType.BookmarkedOnly:
				if (ctx?.bookmarksPluginInstance) {
					const bookmarkOrder: number | undefined = ctx?.bookmarksPluginInstance.determineBookmarkOrder(entry.path)
					if (bookmarkOrder) { // safe ==> orders intentionally start from 1
						determined = true
						bookmarkedIdx = bookmarkOrder
					}
				}
			case CustomSortGroupType.HasIcon:
				if(ctx?.iconFolderPluginInstance) {
					let iconName: string | undefined = determineIconOf(entry, ctx.iconFolderPluginInstance)
					if (iconName) {
						if (group.iconName) {
							determined = iconName === group.iconName
						} else {
							determined = true
						}
					}
				}
				break
			case CustomSortGroupType.MatchAll:
				determined = true;
				break
		}
		if (determined && derivedText) {
			derivedTextWithExt = derivedText + '//' + entry.name
			derivedText = derivedText + '//' + basename
		}
	}

	const idxAfterLastGroupIdx: number = spec.groups.length
	let determinedGroupIdx: number | undefined = determined ? groupIdx! : idxAfterLastGroupIdx

	// Redirection to the first group of combined, if detected
	if (determined) {
		const combinedGroupIdx: number | undefined = spec.groups[determinedGroupIdx].combineWithIdx
		if (combinedGroupIdx !== undefined) {
			determinedGroupIdx = combinedGroupIdx
		}
	}

	if (!determined) {
		// Automatically assign the index to outsiders group, if relevant was configured
		if (isDefined(spec.outsidersFilesGroupIdx) && aFile) {
			determinedGroupIdx = spec.outsidersFilesGroupIdx;
			determined = true
		} else if (isDefined(spec.outsidersFoldersGroupIdx) && aFolder) {
			determinedGroupIdx = spec.outsidersFoldersGroupIdx;
			determined = true
		} else if (isDefined(spec.outsidersGroupIdx)) {
			determinedGroupIdx = spec.outsidersGroupIdx;
			determined = true
		}
	}

	let metadataValueToSortBy: string | undefined
	let metadataValueSecondaryToSortBy: string | undefined
	let metadataValueDerivedPrimaryToSortBy: string | undefined
	let metadataValueDerivedSecondaryToSortBy: string | undefined

	if (determined && determinedGroupIdx !== undefined) {  // <-- defensive code, maybe too defensive
		const group: CustomSortGroup = spec.groups[determinedGroupIdx];
		const isPrimaryOrderByMetadata: boolean = isByMetadata(group?.sorting?.order)
		const isSecondaryOrderByMetadata: boolean = isByMetadata(group?.secondarySorting?.order)
		const isDerivedPrimaryByMetadata: boolean = isByMetadata(spec.defaultSorting?.order)
		const isDerivedSecondaryByMetadata: boolean = isByMetadata(spec.defaultSecondarySorting?.order)
		if (isPrimaryOrderByMetadata || isSecondaryOrderByMetadata || isDerivedPrimaryByMetadata || isDerivedSecondaryByMetadata) {
			if (ctx?._mCache) {
				// For folders - scan metadata of 'folder note'
				// and if index-based folder note mode, scan the index file, giving it the priority
				const notePathToScan: string = aFile ? entry.path : `${entry.path}/${entry.name}.md`
				const frontMatterCache: FrontMatterCache | undefined = ctx._mCache.getCache(notePathToScan)?.frontmatter
				let prioFrontMatterCache: FrontMatterCache | undefined = undefined
				if (aFolder) {
					const indexNoteBasename = ctx?.plugin?.indexNoteBasename()
					if (indexNoteBasename) {
						prioFrontMatterCache = ctx._mCache.getCache(`${entry.path}/${indexNoteBasename}.md`)?.frontmatter
					}
				}
				if (isPrimaryOrderByMetadata) metadataValueToSortBy =
					mdataValueFromFMCaches (
						group.sorting!.byMetadata || group.withMetadataFieldName || DEFAULT_METADATA_FIELD_FOR_SORTING,
						group.sorting!.metadataValueExtractor,
						frontMatterCache,
						prioFrontMatterCache)
				if (isSecondaryOrderByMetadata) metadataValueSecondaryToSortBy =
					mdataValueFromFMCaches (
						group.secondarySorting!.byMetadata || group.withMetadataFieldName || DEFAULT_METADATA_FIELD_FOR_SORTING,
						group.secondarySorting!.metadataValueExtractor,
						frontMatterCache,
						prioFrontMatterCache)
				if (isDerivedPrimaryByMetadata) metadataValueDerivedPrimaryToSortBy =
					mdataValueFromFMCaches (
						spec.defaultSorting!.byMetadata || DEFAULT_METADATA_FIELD_FOR_SORTING,
						spec.defaultSorting!.metadataValueExtractor,
						frontMatterCache,
						prioFrontMatterCache)
				if (isDerivedSecondaryByMetadata) metadataValueDerivedSecondaryToSortBy =
					mdataValueFromFMCaches (
						spec.defaultSecondarySorting!.byMetadata || DEFAULT_METADATA_FIELD_FOR_SORTING,
						spec.defaultSecondarySorting!.metadataValueExtractor,
						frontMatterCache,
						prioFrontMatterCache)
			}
		}
	}

	return {
		// idx of the matched group or idx of Outsiders group or the largest index (= groups count+1)
		groupIdx: determinedGroupIdx,
		sortString: derivedText ?? basename,
		sortStringWithExt: derivedText ? derivedTextWithExt! : entry.name,
		metadataFieldValue: metadataValueToSortBy,
		metadataFieldValueSecondary: metadataValueSecondaryToSortBy,
		metadataFieldValueForDerived: metadataValueDerivedPrimaryToSortBy,
		metadataFieldValueForDerivedSecondary: metadataValueDerivedSecondaryToSortBy,
		isFolder: aFolder,
		folder: aFolder ? (entry as TFolder) : undefined,
		path: entry.path,
		ctime: aFile ? entryAsTFile.stat.ctime : DEFAULT_FOLDER_CTIME,
		mtime: aFile ? entryAsTFile.stat.mtime : DEFAULT_FOLDER_MTIME,
		bookmarkedIdx: bookmarkedIdx
	}
}

const SortOrderRequiringRecursiveFolderDate = new Set<CustomSortOrder>([
	CustomSortOrder.byModifiedTimeAdvancedRecursive,
	CustomSortOrder.byModifiedTimeReverseAdvancedRecursive,
	CustomSortOrder.byCreatedTimeAdvancedRecursive,
	CustomSortOrder.byCreatedTimeReverseAdvancedRecursive
])

export const sortOrderNeedsFolderDeepDates = (...orders: Array<CustomSortOrder | undefined>): boolean => {
	return orders.some((o) => o && SortOrderRequiringRecursiveFolderDate.has(o))
}

const SortOrderRequiringFolderDate = new Set<CustomSortOrder>([
	...SortOrderRequiringRecursiveFolderDate,
	CustomSortOrder.byModifiedTimeAdvanced,
	CustomSortOrder.byModifiedTimeReverseAdvanced,
	CustomSortOrder.byCreatedTimeAdvanced,
	CustomSortOrder.byCreatedTimeReverseAdvanced
])

export const sortOrderNeedsFolderDates = (...orders: Array<CustomSortOrder | undefined>): boolean => {
	return orders.some((o) => o && SortOrderRequiringFolderDate.has(o))
}

const SortOrderRequiringBookmarksOrder = new Set<CustomSortOrder>([
	CustomSortOrder.byBookmarkOrder,
	CustomSortOrder.byBookmarkOrderReverse
])

export const sortOrderNeedsBookmarksOrder = (...orders: Array<CustomSortOrder | undefined>): boolean => {
	return orders.some((o) => o && SortOrderRequiringBookmarksOrder.has(o))
}

// Syntax sugar for readability
export type ModifiedTime = number
export type CreatedTime = number

// TODO: determine how to selectively unmock the Vault.recurseChildren in integration jest test.
//       Until then the implementation for testing is supplied explicitly below, copied from Obsidian code

const recurseChildrenForUnitTests = ((root: TFolder, cb: (file: TAbstractFile) => any) => {
	for (let itemsToIterate: TAbstractFile[] = [root]; itemsToIterate.length > 0;) {
		let firstItem = itemsToIterate.pop();
		if (firstItem) {
			cb(firstItem)
			if (isFolder(firstItem)) {
				let childrenOfFolder = (firstItem as TFolder).children;
				itemsToIterate = itemsToIterate.concat(childrenOfFolder)
			}
		}
	}
})

export const determineDatesForFolder = (folder: TFolder, recursive?: boolean): [ModifiedTime, CreatedTime] => {
	let mtimeOfFolder: ModifiedTime = DEFAULT_FOLDER_MTIME
	let ctimeOfFolder: CreatedTime = DEFAULT_FOLDER_CTIME

	const checkFile = (abFile: TAbstractFile) => {
		if (isFolder(abFile)) return

		const file: TFile = abFile as TFile
		if (file.stat.mtime > mtimeOfFolder) {
			mtimeOfFolder = file.stat.mtime
		}
		if (file.stat.ctime < ctimeOfFolder || ctimeOfFolder === DEFAULT_FOLDER_CTIME) {
			ctimeOfFolder = file.stat.ctime
		}
	}

	if (recursive) {
		(Vault?.recurseChildren ?? recurseChildrenForUnitTests)(folder, checkFile)
	} else {
		folder.children.forEach(checkFile)
	}
	return [mtimeOfFolder, ctimeOfFolder]
}

export const determineFolderDatesIfNeeded = (folderItems: Array<FolderItemForSorting>, sortingSpec: CustomSortSpec) => {
	const foldersDatesNeeded = sortOrderNeedsFolderDates(sortingSpec.defaultSorting?.order, sortingSpec.defaultSecondarySorting?.order)
	const foldersDeepDatesNeeded = sortOrderNeedsFolderDeepDates(sortingSpec.defaultSorting?.order, sortingSpec.defaultSecondarySorting?.order)

	const groupOrders = sortingSpec.groups?.map((group) => ({
		foldersDatesNeeded: sortOrderNeedsFolderDates(group.sorting?.order, group.secondarySorting?.order),
		foldersDeepDatesNeeded: sortOrderNeedsFolderDeepDates(group.sorting?.order, group.secondarySorting?.order)
	}))

	folderItems.forEach((item) => {
		if (item.folder) {
			if (foldersDatesNeeded || (item.groupIdx !== undefined && groupOrders[item.groupIdx].foldersDatesNeeded)) {
				[item.mtime, item.ctime] = determineDatesForFolder(
					item.folder,
					foldersDeepDatesNeeded || (item.groupIdx !== undefined && groupOrders[item.groupIdx].foldersDeepDatesNeeded)
				)
			}
		}
	})
}

// Order by bookmarks order can be applied independently of grouping by bookmarked status
//   This function determines the bookmarked order if the sorting criteria (of group or entire folder) requires it
export const determineBookmarksOrderIfNeeded = (folderItems: Array<FolderItemForSorting>, sortingSpec: CustomSortSpec, plugin: BookmarksPluginInterface) => {
	if (!plugin) return

	const folderDefaultSortRequiresBookmarksOrder: boolean = !!(sortingSpec.defaultSorting && sortOrderNeedsBookmarksOrder(sortingSpec.defaultSorting.order, sortingSpec.defaultSecondarySorting?.order))

	folderItems.forEach((item) => {
		let groupSortRequiresBookmarksOrder: boolean = false
		if (!folderDefaultSortRequiresBookmarksOrder) {
			const groupIdx: number | undefined = item.groupIdx
			if (groupIdx !== undefined) {
				const groupOrder: CustomSortOrder | undefined = sortingSpec.groups[groupIdx].sorting?.order
				const groupSecondaryOrder: CustomSortOrder | undefined = sortingSpec.groups[groupIdx].secondarySorting?.order
				groupSortRequiresBookmarksOrder = sortOrderNeedsBookmarksOrder(groupOrder, groupSecondaryOrder)
			}
		}
		if (folderDefaultSortRequiresBookmarksOrder || groupSortRequiresBookmarksOrder) {
			item.bookmarkedIdx = plugin.determineBookmarkOrder(item.path)
		}
	})
}

export const getSortedFolderItems = function (sortedFolder: TFolder, sortingSpec: CustomSortSpec, ctx: ProcessingContext) {
	const sortOrder = this.sortOrder   // this is bound to FileExplorer Obsidian component
	const allFileItemsCollection = this.fileItems
	return folderSortCore(sortedFolder, sortOrder, sortingSpec, allFileItemsCollection, ctx)
}

const folderSortCore = function (sortedFolder: TFolder, sortOrder: string, sortingSpec: CustomSortSpec, allFileItemsCollection: any, ctx: ProcessingContext) {

	// shallow copy of groups and expand folder-specific macros on them
	sortingSpec.groupsShadow = sortingSpec.groups?.map((group) => Object.assign({} as CustomSortGroup, group))
	const parentFolderName: string|undefined = sortedFolder.name
	expandMacros(sortingSpec, parentFolderName)

	const folderItems: Array<FolderItemForSorting> = (sortedFolder.children // NEW
	    .filter((entry: TFile | TFolder) => {
	        const hide = sortingSpec.itemsToHide?.has(entry.name) ?? false
	        const ignore = sortingSpec.itemsToIgnore?.has(entry.name) ?? false
	        return !hide && !ignore   // skip both hidden and ignored items
	    }))
	    .map((entry: TFile | TFolder) => {
	        const itemForSorting: FolderItemForSorting = determineSortingGroup(entry, sortingSpec, ctx)
	        return itemForSorting
	    })


	// Finally, for advanced sorting by modified date, for some folders the modified date has to be determined
	determineFolderDatesIfNeeded(folderItems, sortingSpec)

	if (ctx.bookmarksPluginInstance) {
		determineBookmarksOrderIfNeeded(folderItems, sortingSpec, ctx.bookmarksPluginInstance)
	}

	const comparator: SorterFn = getComparator(sortingSpec, sortOrder)

	folderItems.sort(comparator)

	const items = folderItems
		.map((item: FolderItemForSorting) => allFileItemsCollection[item.path])

	return items
};

// Returns a sorted copy of the input array, intentionally to keep it intact
export const sortFolderItems = function (folder: TFolder, items: Array<TAbstractFile>, sortingSpec: CustomSortSpec|null|undefined, ctx: ProcessingContext, uiSortOrder: string): Array<TAbstractFile> {
	if (sortingSpec) {
		const folderItemsByPath: { [key: string]: TAbstractFile } = {}

		// shallow copy of groups and expand folder-specific macros on them
		sortingSpec.groupsShadow = sortingSpec.groups?.map((group) => Object.assign({} as CustomSortGroup, group))
		const parentFolderName: string|undefined = folder.name
		expandMacros(sortingSpec, parentFolderName)

		const folderItems: Array<FolderItemForSorting> = items.map((entry: TFile | TFolder) => {
			folderItemsByPath[entry.path] = entry
			const itemForSorting: FolderItemForSorting = determineSortingGroup(entry, sortingSpec, ctx)
			return itemForSorting
		})

		// Finally, for advanced sorting by modified date, for some folders the modified date has to be determined
		determineFolderDatesIfNeeded(folderItems, sortingSpec)

		if (ctx.bookmarksPluginInstance) {
			determineBookmarksOrderIfNeeded(folderItems, sortingSpec, ctx.bookmarksPluginInstance)
		}

		const comparator: SorterFn = getComparator(sortingSpec, uiSortOrder)

		folderItems.sort(comparator)

		const sortedItems: Array<TAbstractFile> = folderItems.map((entry) => folderItemsByPath[entry.path])

		return sortedItems
	} else { // No custom sorting or the custom sort disabled - apply standard Obsidian sorting (internally 1:1 recreated implementation)
		const folderItems: Array<TAbstractFile> = items.map((entry: TFile | TFolder) => entry)
		const plainSorterFn: PlainSorterFn = StandardPlainObsidianComparator(uiSortOrder)
		folderItems.sort(plainSorterFn)
		return folderItems
	}
};

// Exported legacy function name for backward compatibility
export const sortFolderItemsForBookmarking = sortFolderItems

export const _unitTests = {
	fileGoesFirstWhenSameBasenameAsFolder: fileGoesFirstWhenSameBasenameAsFolder,
	folderGoesFirstWhenSameBasenameAsFolder: folderGoesFirstWhenSameBasenameAsFolder
}
