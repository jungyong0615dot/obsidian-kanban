import update from 'immutability-helper';
import { moment } from 'obsidian';
import { KanbanView } from 'src/KanbanView';
import { StateManager } from 'src/StateManager';
import { Path } from 'src/dnd/types';
import {
  appendEntities,
  getEntityFromPath,
  insertEntity,
  moveEntity,
  prependEntities,
  removeEntity,
  updateEntity,
  updateParentEntity,
} from 'src/dnd/util/data';

import { generateInstanceId } from '../components/helpers';
import {
  getLaneItems,
  isSection,
  normalizeBoardLane,
  normalizeLaneSections,
} from '../components/nestedSections';
import { Board, DataTypes, Item, Lane } from '../components/types';

export interface BoardModifiers {
  appendItems: (path: Path, items: Item[]) => void;
  prependItems: (path: Path, items: Item[]) => void;
  insertItems: (path: Path, items: Item[]) => void;
  replaceItem: (path: Path, items: Item[]) => void;
  splitItem: (path: Path, items: Item[]) => void;
  moveItemToTop: (path: Path) => void;
  moveItemToBottom: (path: Path) => void;
  addLane: (lane: Lane) => void;
  insertLane: (path: Path, lane: Lane) => void;
  updateLane: (path: Path, lane: Lane) => void;
  archiveLane: (path: Path) => void;
  archiveLaneItems: (path: Path) => void;
  deleteEntity: (path: Path) => void;
  updateItem: (path: Path, item: Item) => void;
  archiveItem: (path: Path) => void;
  duplicateEntity: (path: Path) => void;
}

export function getBoardModifiers(view: KanbanView, stateManager: StateManager): BoardModifiers {
  const appendArchiveDate = (item: Item) => {
    const archiveDateFormat = stateManager.getSetting('archive-date-format');
    const archiveDateSeparator = stateManager.getSetting('archive-date-separator');
    const archiveDateAfterTitle = stateManager.getSetting('append-archive-date');

    const newTitle = [moment().format(archiveDateFormat)];

    if (archiveDateSeparator) newTitle.push(archiveDateSeparator);

    newTitle.push(item.data.titleRaw);

    if (archiveDateAfterTitle) newTitle.reverse();

    const titleRaw = newTitle.join(' ');
    return stateManager.updateItemContent(item, titleRaw);
  };

  const normalizeLaneAtPath = (board: Board, path: Path) => {
    if (!path.length) {
      return board;
    }

    return normalizeBoardLane(board, path[0]);
  };

  return {
    appendItems: (path: Path, items: Item[]) => {
      stateManager.setState((boardData) => {
        return normalizeLaneAtPath(appendEntities(boardData, path, items), path);
      });
    },

    prependItems: (path: Path, items: Item[]) => {
      stateManager.setState((boardData) => {
        return normalizeLaneAtPath(prependEntities(boardData, path, items), path);
      });
    },

    insertItems: (path: Path, items: Item[]) => {
      stateManager.setState((boardData) => {
        return normalizeLaneAtPath(insertEntity(boardData, path, items), path);
      });
    },

    replaceItem: (path: Path, items: Item[]) => {
      stateManager.setState((boardData) =>
        normalizeLaneAtPath(insertEntity(removeEntity(boardData, path), path, items), path)
      );
    },

    splitItem: (path: Path, items: Item[]) => {
      stateManager.setState((boardData) => {
        return normalizeLaneAtPath(insertEntity(removeEntity(boardData, path), path, items), path);
      });
    },

    moveItemToTop: (path: Path) => {
      stateManager.setState((boardData) =>
        normalizeLaneAtPath(moveEntity(boardData, path, [path[0], 0]), path)
      );
    },

    moveItemToBottom: (path: Path) => {
      stateManager.setState((boardData) => {
        const laneIndex = path[0];
        const lane = boardData.children[laneIndex];
        return normalizeLaneAtPath(
          moveEntity(boardData, path, [laneIndex, lane.children.length]),
          path
        );
      });
    },

    addLane: (lane: Lane) => {
      stateManager.setState((boardData) => {
        const collapseState = view.getViewState('list-collapse') || [];
        const op = (collapseState: boolean[]) => {
          const newState = [...collapseState];
          newState.push(false);
          return newState;
        };

        view.setViewState('list-collapse', undefined, op);
        return update<Board>(appendEntities(boardData, [], [normalizeLaneSections(lane)]), {
          data: { settings: { 'list-collapse': { $set: op(collapseState) } } },
        });
      });
    },

    insertLane: (path: Path, lane: Lane) => {
      stateManager.setState((boardData) => {
        const collapseState = view.getViewState('list-collapse');
        const op = (collapseState: boolean[]) => {
          const newState = [...collapseState];
          newState.splice(path.last(), 0, false);
          return newState;
        };

        view.setViewState('list-collapse', undefined, op);

        return update<Board>(insertEntity(boardData, path, [normalizeLaneSections(lane)]), {
          data: { settings: { 'list-collapse': { $set: op(collapseState) } } },
        });
      });
    },

    updateLane: (path: Path, lane: Lane) => {
      stateManager.setState((boardData) =>
        updateParentEntity(boardData, path, {
          children: {
            [path[path.length - 1]]: {
              $set: normalizeLaneSections(lane),
            },
          },
        })
      );
    },

    archiveLane: (path: Path) => {
      stateManager.setState((boardData) => {
        const lane = getEntityFromPath(boardData, path);
        const items = [...getLaneItems(lane), ...(lane.data.archive || [])];

        try {
          const collapseState = view.getViewState('list-collapse');
          const op = (collapseState: boolean[]) => {
            const newState = [...collapseState];
            newState.splice(path.last(), 1);
            return newState;
          };
          view.setViewState('list-collapse', undefined, op);

          return update<Board>(removeEntity(boardData, path), {
            data: {
              settings: { 'list-collapse': { $set: op(collapseState) } },
              archive: {
                $unshift: stateManager.getSetting('archive-with-date')
                  ? items.map(appendArchiveDate)
                  : items,
              },
            },
          });
        } catch (e) {
          stateManager.setError(e);
          return boardData;
        }
      });
    },

    archiveLaneItems: (path: Path) => {
      stateManager.setState((boardData) => {
        const lane = getEntityFromPath(boardData, path);
        const items = getLaneItems(lane);
        const emptySections = lane.children.filter(isSection).map((section) =>
          update(section, {
            children: {
              $set: [],
            },
          })
        );

        try {
          return normalizeLaneAtPath(
            updateEntity(boardData, path, {
              children: {
                $set: emptySections,
              },
              data: {
                archive: {
                  $push: stateManager.getSetting('archive-with-date')
                    ? items.map(appendArchiveDate)
                    : items,
                },
              },
            }),
            path
          );
        } catch (e) {
          stateManager.setError(e);
          return boardData;
        }
      });
    },

    deleteEntity: (path: Path) => {
      stateManager.setState((boardData) => {
        const entity = getEntityFromPath(boardData, path);

        if (entity.type === DataTypes.Lane) {
          const collapseState = view.getViewState('list-collapse');
          const op = (collapseState: boolean[]) => {
            const newState = [...collapseState];
            newState.splice(path.last(), 1);
            return newState;
          };
          view.setViewState('list-collapse', undefined, op);

          return update<Board>(removeEntity(boardData, path), {
            data: { settings: { 'list-collapse': { $set: op(collapseState) } } },
          });
        }

        return normalizeLaneAtPath(removeEntity(boardData, path), path);
      });
    },

    updateItem: (path: Path, item: Item) => {
      stateManager.setState((boardData) => {
        return normalizeLaneAtPath(
          updateParentEntity(boardData, path, {
            children: {
              [path[path.length - 1]]: {
                $set: item,
              },
            },
          }),
          path
        );
      });
    },

    archiveItem: (path: Path) => {
      stateManager.setState((boardData) => {
        const item = getEntityFromPath(boardData, path);
        try {
          const lanePath = [path[0]];
          const nextBoard = removeEntity(boardData, path);

          return updateEntity(nextBoard, lanePath, {
            data: {
              archive: {
                $push: [
                  stateManager.getSetting('archive-with-date') ? appendArchiveDate(item) : item,
                ],
              },
            },
          });
        } catch (e) {
          stateManager.setError(e);
          return boardData;
        }
      });
    },

    duplicateEntity: (path: Path) => {
      stateManager.setState((boardData) => {
        const entity = getEntityFromPath(boardData, path);
        const entityWithNewID = update(entity, {
          id: {
            $set: generateInstanceId(),
          },
        });

        if (entity.type === DataTypes.Lane) {
          const collapseState = view.getViewState('list-collapse');
          const op = (collapseState: boolean[]) => {
            const newState = [...collapseState];
            newState.splice(path.last(), 0, collapseState[path.last()]);
            return newState;
          };
          view.setViewState('list-collapse', undefined, op);

          return update<Board>(
            insertEntity(boardData, path, [normalizeLaneSections(entityWithNewID as Lane)]),
            {
              data: { settings: { 'list-collapse': { $set: op(collapseState) } } },
            }
          );
        }

        return normalizeLaneAtPath(insertEntity(boardData, path, [entityWithNewID]), path);
      });
    },
  };
}
