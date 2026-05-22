import update from 'immutability-helper';
import { Content, List, Parent, Root } from 'mdast';
import { ListItem } from 'mdast-util-from-markdown/lib';
import { toString } from 'mdast-util-to-string';
import { stringifyYaml } from 'obsidian';
import { KanbanSettings } from 'src/Settings';
import { StateManager } from 'src/StateManager';
import { generateInstanceId } from 'src/components/helpers';
import {
  createSection,
  getLaneRootItems,
  getLaneSections,
  isItem,
  isSection,
  normalizeLaneSections,
} from 'src/components/nestedSections';
import {
  Board,
  BoardTemplate,
  Item,
  ItemData,
  ItemTemplate,
  Lane,
  LaneChild,
  LaneTemplate,
  Section,
} from 'src/components/types';
import { laneTitleWithMaxItems } from 'src/helpers';
import { defaultSort } from 'src/helpers/util';
import { t } from 'src/lang/helpers';
import { visit } from 'unist-util-visit';

import { archiveString, completeString, settingsToCodeblock } from '../common';
import { DateNode, FileNode, TimeNode, ValueNode } from '../extensions/types';
import {
  ContentBoundary,
  getNodeContentBoundary,
  getPrevSibling,
  getStringFromBoundary,
} from '../helpers/ast';
import { hydrateItem, preprocessTitle } from '../helpers/hydrateBoard';
import { extractInlineFields, taskFields } from '../helpers/inlineMetadata';
import {
  addBlockId,
  dedentNewLines,
  executeDeletion,
  indentNewLines,
  markRangeForDeletion,
  parseLaneTitle,
  removeBlockId,
  replaceBrs,
  replaceNewLines,
} from '../helpers/parser';
import { parseFragment } from '../parseMarkdown';

interface TaskItem extends ListItem {
  checkChar?: string;
}

const laneArchiveString = '%% kanban:archive %%';

export function listItemToItemData(stateManager: StateManager, md: string, item: TaskItem) {
  const moveTags = stateManager.getSetting('move-tags');
  const moveDates = stateManager.getSetting('move-dates');

  const startNode = item.children.first();
  const endNode = item.children.last();

  const start =
    startNode.type === 'paragraph'
      ? getNodeContentBoundary(startNode).start
      : startNode.position.start.offset;
  const end =
    endNode.type === 'paragraph'
      ? getNodeContentBoundary(endNode).end
      : endNode.position.end.offset;
  const itemBoundary: ContentBoundary = { start, end };

  let itemContent = getStringFromBoundary(md, itemBoundary);

  // Handle empty task
  if (itemContent === '[' + (item.checked ? item.checkChar : ' ') + ']') {
    itemContent = '';
  }

  let title = itemContent;
  let titleSearch = '';

  visit(
    item,
    ['text', 'wikilink', 'embedWikilink', 'image', 'inlineCode', 'code', 'hashtag'],
    (node: any, i, parent) => {
      if (node.type === 'hashtag') {
        if (!parent.children.first()?.value?.startsWith('```')) {
          titleSearch += ' #' + node.value;
        }
      } else {
        titleSearch += node.value || node.alt || '';
      }
    }
  );

  const itemData: ItemData = {
    titleRaw: removeBlockId(dedentNewLines(replaceBrs(itemContent))),
    blockId: undefined,
    title: '',
    titleSearch,
    titleSearchRaw: titleSearch,
    metadata: {
      dateStr: undefined,
      date: undefined,
      time: undefined,
      timeStr: undefined,
      tags: [],
      fileAccessor: undefined,
      file: undefined,
      fileMetadata: undefined,
      fileMetadataOrder: undefined,
    },
    checked: item.checked,
    checkChar: item.checked ? item.checkChar || ' ' : ' ',
  };

  visit(
    item,
    (node) => {
      return node.type !== 'paragraph';
    },
    (node, i, parent) => {
      const genericNode = node as ValueNode;

      if (genericNode.type === 'blockid') {
        itemData.blockId = genericNode.value;
        return true;
      }

      if (
        genericNode.type === 'hashtag' &&
        !(parent.children.first() as any)?.value?.startsWith('```')
      ) {
        if (!itemData.metadata.tags) {
          itemData.metadata.tags = [];
        }

        itemData.metadata.tags.push('#' + genericNode.value);

        if (moveTags) {
          title = markRangeForDeletion(title, {
            start: node.position.start.offset - itemBoundary.start,
            end: node.position.end.offset - itemBoundary.start,
          });
        }
        return true;
      }

      if (genericNode.type === 'date' || genericNode.type === 'dateLink') {
        itemData.metadata.dateStr = (genericNode as DateNode).date;

        if (moveDates) {
          title = markRangeForDeletion(title, {
            start: node.position.start.offset - itemBoundary.start,
            end: node.position.end.offset - itemBoundary.start,
          });
        }
        return true;
      }

      if (genericNode.type === 'time') {
        itemData.metadata.timeStr = (genericNode as TimeNode).time;
        if (moveDates) {
          title = markRangeForDeletion(title, {
            start: node.position.start.offset - itemBoundary.start,
            end: node.position.end.offset - itemBoundary.start,
          });
        }
        return true;
      }

      if (genericNode.type === 'embedWikilink') {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        return true;
      }

      if (genericNode.type === 'wikilink') {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        itemData.metadata.fileMetadata = (genericNode as FileNode).fileMetadata;
        itemData.metadata.fileMetadataOrder = (genericNode as FileNode).fileMetadataOrder;
        return true;
      }

      if (genericNode.type === 'link' && (genericNode as FileNode).fileAccessor) {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        itemData.metadata.fileMetadata = (genericNode as FileNode).fileMetadata;
        itemData.metadata.fileMetadataOrder = (genericNode as FileNode).fileMetadataOrder;
        return true;
      }

      if (genericNode.type === 'embedLink') {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        return true;
      }
    }
  );

  itemData.title = preprocessTitle(stateManager, dedentNewLines(executeDeletion(title)));

  const firstLineEnd = itemData.title.indexOf('\n');
  const inlineFields = extractInlineFields(itemData.title, true);

  if (inlineFields?.length) {
    const inlineMetadata = (itemData.metadata.inlineMetadata = inlineFields.reduce((acc, curr) => {
      if (!taskFields.has(curr.key)) acc.push(curr);
      else if (firstLineEnd <= 0 || curr.end < firstLineEnd) acc.push(curr);

      return acc;
    }, []));

    const moveTaskData = stateManager.getSetting('move-task-metadata');
    const moveMetadata = stateManager.getSetting('inline-metadata-position') !== 'body';

    if (moveTaskData || moveMetadata) {
      let title = itemData.title;
      for (const item of [...inlineMetadata].reverse()) {
        const isTask = taskFields.has(item.key);

        if (isTask && !moveTaskData) continue;
        if (!isTask && !moveMetadata) continue;

        title = title.slice(0, item.start) + title.slice(item.end);
      }

      itemData.title = title;
    }
  }

  itemData.metadata.tags?.sort(defaultSort);

  return itemData;
}

function isArchiveLane(child: Content, children: Content[], currentIndex: number) {
  if (child.type !== 'heading' || toString(child, { includeImageAlt: false }) !== t('Archive')) {
    return false;
  }

  const prev = getPrevSibling(children, currentIndex);

  return prev && prev.type === 'thematicBreak';
}

function isLaneArchiveMarker(child: Content) {
  return child.type === 'paragraph' && toString(child).trim() === laneArchiveString;
}

function isNestedSectionHeading(child: Content) {
  return child.type === 'heading' && (child as any).depth === 3;
}

function getLaneSectionChildren(children: Content[], currentIndex: number) {
  const sectionChildren: Content[] = [];

  for (let i = currentIndex + 1, len = children.length; i < len; i++) {
    const child = children[i];
    if (child.type === 'heading' && (child as any).depth === 2) {
      break;
    }

    sectionChildren.push(child);
  }

  return sectionChildren;
}

function getNestedSectionChildren(children: Content[], currentIndex: number) {
  const sectionChildren: Content[] = [];

  for (let i = currentIndex + 1, len = children.length; i < len; i++) {
    const child = children[i];
    if (child.type === 'heading' && (child as any).depth <= 3) {
      break;
    }

    if (isLaneArchiveMarker(child)) {
      break;
    }

    sectionChildren.push(child);
  }

  return sectionChildren;
}

function listToItems(stateManager: StateManager, md: string, list: List): Item[] {
  return list.children.map((listItem) => {
    return {
      ...ItemTemplate,
      id: generateInstanceId(),
      data: listItemToItemData(stateManager, md, listItem),
    };
  });
}

function nestedSectionToSection(
  stateManager: StateManager,
  md: string,
  heading: Content,
  sectionChildren: Content[]
): Section {
  const headingBoundary = getNodeContentBoundary(heading as Parent);
  const title = getStringFromBoundary(md, headingBoundary);
  const list = sectionChildren.find((sectionChild) => sectionChild.type === 'list') as List;

  return createSection(title, list ? listToItems(stateManager, md, list) : []);
}

export function astToUnhydratedBoard(
  stateManager: StateManager,
  settings: KanbanSettings,
  frontmatter: Record<string, any>,
  root: Root,
  md: string
): Board {
  const lanes: Lane[] = [];
  const archive: Item[] = [];
  root.children.forEach((child, index) => {
    if (child.type === 'heading' && (child as any).depth === 2) {
      const isArchive = isArchiveLane(child, root.children, index);
      const headingBoundary = getNodeContentBoundary(child as Parent);
      const title = getStringFromBoundary(md, headingBoundary);
      const sectionChildren = getLaneSectionChildren(root.children, index);

      let shouldMarkItemsComplete = false;
      let list: List = null;
      let archiveList: List = null;
      let didHitArchiveMarker = false;
      const nestedSections: Section[] = [];

      for (let i = 0, len = sectionChildren.length; i < len; i++) {
        const sectionChild = sectionChildren[i];

        if (sectionChild.type === 'paragraph') {
          const childStr = toString(sectionChild);

          if (childStr.startsWith('%% kanban:settings')) {
            continue;
          }

          if (childStr === t('Complete')) {
            shouldMarkItemsComplete = true;
            continue;
          }
        }

        if (isNestedSectionHeading(sectionChild)) {
          const nestedChildren = getNestedSectionChildren(sectionChildren, i);
          nestedSections.push(
            nestedSectionToSection(stateManager, md, sectionChild, nestedChildren)
          );
          i += nestedChildren.length;
          continue;
        }

        if (isLaneArchiveMarker(sectionChild)) {
          didHitArchiveMarker = true;
          continue;
        }

        if (sectionChild.type === 'list') {
          if (didHitArchiveMarker && !archiveList) {
            archiveList = sectionChild as List;
            continue;
          }

          if (!list) {
            list = sectionChild as List;
          }
        }
      }

      if (isArchive && list) {
        archive.push(...listToItems(stateManager, md, list));

        return;
      }

      const children: LaneChild[] = [...(list ? listToItems(stateManager, md, list) : [])];
      children.push(...nestedSections);
      const lane = normalizeLaneSections({
        ...LaneTemplate,
        children,
        id: generateInstanceId(),
        data: {
          ...parseLaneTitle(title),
          archive: archiveList ? listToItems(stateManager, md, archiveList) : [],
          shouldMarkItemsComplete,
        },
      });

      lanes.push(lane);
    }
  });

  return {
    ...BoardTemplate,
    id: stateManager.file.path,
    children: lanes,
    data: {
      settings,
      frontmatter,
      archive,
      isSearching: false,
      errors: [],
    },
  };
}

export function updateItemContent(stateManager: StateManager, oldItem: Item, newContent: string) {
  const md = `- [${oldItem.data.checkChar}] ${addBlockId(indentNewLines(newContent), oldItem)}`;

  const ast = parseFragment(stateManager, md);
  const itemData = listItemToItemData(stateManager, md, (ast.children[0] as List).children[0]);
  const newItem = update(oldItem, {
    data: {
      $set: itemData,
    },
  });

  try {
    hydrateItem(stateManager, newItem);
  } catch (e) {
    console.error(e);
  }

  return newItem;
}

export function newItem(
  stateManager: StateManager,
  newContent: string,
  checkChar: string,
  forceEdit?: boolean
) {
  const md = `- [${checkChar}] ${indentNewLines(newContent)}`;
  const ast = parseFragment(stateManager, md);
  const itemData = listItemToItemData(stateManager, md, (ast.children[0] as List).children[0]);

  itemData.forceEditMode = !!forceEdit;

  const newItem: Item = {
    ...ItemTemplate,
    id: generateInstanceId(),
    data: itemData,
  };

  try {
    hydrateItem(stateManager, newItem);
  } catch (e) {
    console.error(e);
  }

  return newItem;
}

export function reparseBoard(stateManager: StateManager, board: Board) {
  try {
    return update(board, {
      children: {
        $set: board.children.map((lane) => {
          return normalizeLaneSections(
            update(lane, {
              children: {
                $set: lane.children.map((child) => {
                  if (isItem(child)) {
                    return updateItemContent(stateManager, child, child.data.titleRaw);
                  }

                  if (isSection(child)) {
                    return update(child, {
                      children: {
                        $set: child.children.map((item) => {
                          return updateItemContent(stateManager, item, item.data.titleRaw);
                        }),
                      },
                    });
                  }

                  return child;
                }),
              },
              data: {
                archive: {
                  $set: lane.data.archive.map((item) => {
                    return updateItemContent(stateManager, item, item.data.titleRaw);
                  }),
                },
              },
            })
          );
        }),
      },
      data: {
        archive: {
          $set: board.data.archive.map((item) => {
            return updateItemContent(stateManager, item, item.data.titleRaw);
          }),
        },
      },
    });
  } catch (e) {
    stateManager.setError(e);
    throw e;
  }
}

function itemToMd(item: Item) {
  return `- [${item.data.checkChar}] ${addBlockId(indentNewLines(item.data.titleRaw), item)}`;
}

function laneToMd(lane: Lane) {
  const lines: string[] = [];
  const archive = lane.data.archive || [];

  lines.push(`## ${replaceNewLines(laneTitleWithMaxItems(lane.data.title, lane.data.maxItems))}`);

  lines.push('');

  if (lane.data.shouldMarkItemsComplete) {
    lines.push(completeString);
  }

  getLaneRootItems(lane).forEach(({ item }) => {
    lines.push(itemToMd(item));
  });

  getLaneSections(lane).forEach(({ section }) => {
    lines.push('');
    lines.push(`### ${replaceNewLines(section.data.title)}`);
    lines.push('');
    section.children.forEach((item) => {
      lines.push(itemToMd(item));
    });
  });

  if (archive.length) {
    lines.push('');
    lines.push(laneArchiveString);
    lines.push('');
    archive.forEach((item) => {
      lines.push(itemToMd(item));
    });
  }

  lines.push('');
  lines.push('');
  lines.push('');

  return lines.join('\n');
}

function archiveToMd(archive: Item[]) {
  if (archive.length) {
    const lines: string[] = [archiveString, '', `## ${t('Archive')}`, ''];

    archive.forEach((item) => {
      lines.push(itemToMd(item));
    });

    return lines.join('\n');
  }

  return '';
}

export function boardToMd(board: Board) {
  const lanes = board.children.reduce((md, lane) => {
    return md + laneToMd(lane);
  }, '');

  const frontmatter = ['---', '', stringifyYaml(board.data.frontmatter), '---', '', ''].join('\n');

  return frontmatter + lanes + archiveToMd(board.data.archive) + settingsToCodeblock(board);
}
