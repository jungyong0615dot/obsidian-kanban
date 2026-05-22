import update from 'immutability-helper';
import { getTaskStatusDone } from 'src/parsers/helpers/inlineMetadata';

import { Board, DataTypes, Item, Lane, LaneChild, Section, SectionTemplate } from './types';

export const defaultDoneSectionTitle = 'done';

function generateSectionId(len: number = 9): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + len);
}

export function isItem(entity: LaneChild | Item): entity is Item {
  return entity?.type === DataTypes.Item;
}

export function isSection(entity: LaneChild): entity is Section {
  return entity?.type === DataTypes.Section;
}

export function isDoneItem(item: Item) {
  return item.data.checked && item.data.checkChar === getTaskStatusDone();
}

export function isDoneSectionTitle(title: string) {
  return title.trim().toLocaleLowerCase() === defaultDoneSectionTitle;
}

export function isDoneSection(section: Section) {
  return isDoneSectionTitle(section.data.title);
}

export function createSection(title: string, children: Item[] = []): Section {
  return {
    ...SectionTemplate,
    id: generateSectionId(),
    children,
    data: {
      title,
      shouldMarkItemsComplete: isDoneSectionTitle(title),
    },
  };
}

export function createDoneSection(children: Item[] = []): Section {
  return createSection(defaultDoneSectionTitle, children);
}

export function getLaneRootItems(lane: Lane): Array<{ item: Item; index: number }> {
  return lane.children.reduce<Array<{ item: Item; index: number }>>((items, child, index) => {
    if (isItem(child)) {
      items.push({ item: child, index });
    }

    return items;
  }, []);
}

export function getLaneSections(lane: Lane): Array<{ section: Section; index: number }> {
  return lane.children.reduce<Array<{ section: Section; index: number }>>(
    (sections, child, index) => {
      if (isSection(child)) {
        sections.push({ section: child, index });
      }

      return sections;
    },
    []
  );
}

export function getLaneItems(lane: Lane): Item[] {
  return lane.children.reduce<Item[]>((items, child) => {
    if (isItem(child)) {
      items.push(child);
    } else if (isSection(child)) {
      items.push(...child.children);
    }

    return items;
  }, []);
}

export function getLaneItemCount(lane: Lane) {
  return getLaneItems(lane).length;
}

export function getLaneRootInsertIndex(lane: Lane) {
  const firstSectionIndex = lane.children.findIndex(isSection);
  return firstSectionIndex === -1 ? lane.children.length : firstSectionIndex;
}

function markItemDone(item: Item): Item {
  if (isDoneItem(item)) {
    return item;
  }

  return update(item, {
    data: {
      checked: { $set: true },
      checkChar: { $set: getTaskStatusDone() },
    },
  });
}

export function normalizeLaneSections(lane: Lane): Lane {
  const rootItems: Item[] = [];
  const sections: Section[] = [];
  let doneSectionIndex = -1;
  const doneItems: Item[] = [];

  lane.children.forEach((child) => {
    if (isItem(child)) {
      if (isDoneItem(child)) {
        doneItems.push(child);
      } else {
        rootItems.push(child);
      }

      return;
    }

    if (!isSection(child)) {
      return;
    }

    if (isDoneSection(child)) {
      const sectionItems: Item[] = [];
      child.children.forEach((item) => {
        if (isDoneItem(item)) {
          sectionItems.push(item);
        } else {
          rootItems.push(item);
        }
      });

      if (doneSectionIndex === -1) {
        doneSectionIndex = sections.length;
        sections.push(
          update(child, {
            data: {
              shouldMarkItemsComplete: { $set: true },
            },
            children: {
              $set: sectionItems,
            },
          })
        );
      } else {
        const doneSection = sections[doneSectionIndex];
        sections[doneSectionIndex] = update(doneSection, {
          children: {
            $push: sectionItems,
          },
        });
      }

      return;
    }

    const sectionItems: Item[] = [];
    child.children.forEach((item) => {
      if (isDoneItem(item)) {
        doneItems.push(item);
      } else {
        sectionItems.push(item);
      }
    });

    sections.push(
      update(child, {
        data: {
          shouldMarkItemsComplete: { $set: !!child.data.shouldMarkItemsComplete },
        },
        children: {
          $set: sectionItems,
        },
      })
    );
  });

  if (doneSectionIndex === -1) {
    doneSectionIndex = sections.length;
    sections.push(createDoneSection());
  }

  const normalizedDoneSection = sections[doneSectionIndex];
  sections[doneSectionIndex] = update(normalizedDoneSection, {
    children: {
      $set: [...normalizedDoneSection.children, ...doneItems.map(markItemDone)],
    },
    data: {
      shouldMarkItemsComplete: { $set: true },
    },
  });

  return update(lane, {
    children: {
      $set: [...rootItems, ...sections],
    },
  });
}

export function normalizeBoardLane(board: Board, laneIndex: number): Board {
  const lane = board.children[laneIndex];
  if (!lane) {
    return board;
  }

  return update(board, {
    children: {
      [laneIndex]: {
        $set: normalizeLaneSections(lane),
      },
    },
  });
}

export function normalizeBoardLanes(board: Board, laneIndexes: number[]): Board {
  return Array.from(new Set(laneIndexes)).reduce((nextBoard, laneIndex) => {
    return normalizeBoardLane(nextBoard, laneIndex);
  }, board);
}

export function sortLaneRootItems(lane: Lane, compare: (a: Item, b: Item) => number): Lane {
  const sortedItems = getLaneRootItems(lane)
    .map(({ item }) => item)
    .sort(compare);
  let itemIndex = 0;

  return update(lane, {
    children: {
      $set: lane.children.map((child) => {
        if (!isItem(child)) {
          return child;
        }

        return sortedItems[itemIndex++];
      }),
    },
  });
}

export function sortLaneItems(lane: Lane, compare: (a: Item, b: Item) => number): Lane {
  const laneWithSortedRoot = sortLaneRootItems(lane, compare);

  return update(laneWithSortedRoot, {
    children: {
      $set: laneWithSortedRoot.children.map((child) => {
        if (!isSection(child)) {
          return child;
        }

        return update(child, {
          children: {
            $set: child.children.slice().sort(compare),
          },
        });
      }),
    },
  });
}
