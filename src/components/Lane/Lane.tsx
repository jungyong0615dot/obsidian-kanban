import animateScrollTo from 'animated-scroll-to';
import classcat from 'classcat';
import update from 'immutability-helper';
import { Fragment, memo, useCallback, useContext, useMemo, useRef, useState } from 'preact/compat';
import {
  DraggableProps,
  Droppable,
  StaticDroppable,
  useNestedEntityPath,
} from 'src/dnd/components/Droppable';
import { ScrollContainer } from 'src/dnd/components/ScrollContainer';
import { SortPlaceholder } from 'src/dnd/components/SortPlaceholder';
import { Sortable, StaticSortable } from 'src/dnd/components/Sortable';
import { useDragHandle } from 'src/dnd/managers/DragManager';
import { frontmatterKey } from 'src/parsers/common';
import { getTaskStatusDone } from 'src/parsers/helpers/inlineMetadata';

import { Items } from '../Item/Item';
import { ItemForm } from '../Item/ItemForm';
import { KanbanContext, SearchContext, SortContext } from '../context';
import { c, generateInstanceId } from '../helpers';
import {
  getLaneItemCount,
  getLaneRootInsertIndex,
  getLaneRootItems,
  getLaneSections,
} from '../nestedSections';
import { DataTypes, EditState, EditingState, Item, Lane, Section } from '../types';
import { LaneArchive } from './LaneArchive';
import { LaneHeader } from './LaneHeader';

const laneAccepts = [DataTypes.Item];

interface NestedSectionProps {
  section: Section;
  sectionIndex: number;
  isStatic?: boolean;
  laneShouldMarkItemsComplete: boolean;
}

const NestedSection = memo(function NestedSection({
  section,
  sectionIndex,
  isStatic,
  laneShouldMarkItemsComplete,
}: NestedSectionProps) {
  const [isSorting, setIsSorting] = useState(false);
  const search = useContext(SearchContext);
  const elementRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const DroppableComponent = isStatic ? StaticDroppable : Droppable;
  const SortableComponent = isStatic ? StaticSortable : Sortable;
  const sectionDropData = useMemo(
    () => ({
      ...section,
      acceptsSort: [],
    }),
    [section]
  );
  const shouldMarkItemsComplete =
    laneShouldMarkItemsComplete || !!section.data.shouldMarkItemsComplete;
  const visibleItems = useMemo(() => {
    if (!search?.query) {
      return section.children;
    }

    return section.children.filter((item) => search.items.has(item));
  }, [section.children, search]);

  if (search?.query && !visibleItems.length) {
    return null;
  }

  return (
    <div
      ref={measureRef}
      className={classcat([
        c('nested-section-wrapper'),
        {
          'is-sorting': isSorting,
          'is-complete-section': shouldMarkItemsComplete,
        },
      ])}
    >
      <div ref={elementRef} className={c('nested-section')}>
        <div className={c('nested-section-header')}>
          <div className={c('nested-section-title')}>{section.data.title}</div>
          <div className={c('nested-section-count')}>{section.children.length}</div>
        </div>
        <DroppableComponent
          elementRef={elementRef}
          measureRef={measureRef}
          id={section.id}
          index={sectionIndex}
          data={sectionDropData}
        >
          <div className={classcat([c('lane-items'), c('nested-section-items')])}>
            <SortableComponent onSortChange={setIsSorting} axis="vertical">
              <Items
                items={section.children}
                isStatic={isStatic}
                shouldMarkItemsComplete={shouldMarkItemsComplete}
              />
              <SortPlaceholder
                accepts={laneAccepts}
                index={section.children.length}
                isStatic={isStatic}
              />
            </SortableComponent>
          </div>
        </DroppableComponent>
      </div>
    </div>
  );
});

export interface DraggableLaneProps {
  lane: Lane;
  laneIndex: number;
  isStatic?: boolean;
  collapseDir: 'horizontal' | 'vertical';
  isCollapsed?: boolean;
}

function DraggableLaneRaw({
  isStatic,
  lane,
  laneIndex,
  collapseDir,
  isCollapsed = false,
}: DraggableLaneProps) {
  const [editState, setEditState] = useState<EditState>(EditingState.cancel);
  const [isSorting, setIsSorting] = useState(false);

  const { stateManager, boardModifiers, view } = useContext(KanbanContext);
  const search = useContext(SearchContext);

  const boardView = view.useViewState(frontmatterKey);
  const path = useNestedEntityPath(laneIndex);
  const laneWidth = stateManager.useSetting('lane-width');
  const fullWidth = boardView === 'list' && stateManager.useSetting('full-list-lane-width');
  const insertionMethod = stateManager.useSetting('new-card-insertion-method');
  const laneStyles = useMemo(
    () =>
      !(isCollapsed && collapseDir === 'horizontal') && (fullWidth || laneWidth)
        ? { width: fullWidth ? '100%' : `${laneWidth}px` }
        : undefined,
    [fullWidth, laneWidth, isCollapsed]
  );

  const elementRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);

  const bindHandle = useDragHandle(measureRef, dragHandleRef);

  const shouldMarkItemsComplete = !!lane.data.shouldMarkItemsComplete;
  const isCompactPrepend = insertionMethod === 'prepend-compact';
  const shouldPrepend = isCompactPrepend || insertionMethod === 'prepend';
  const rootItems = useMemo(() => getLaneRootItems(lane), [lane.children]);
  const sections = useMemo(() => getLaneSections(lane), [lane.children]);
  const itemCount = useMemo(() => getLaneItemCount(lane), [lane.children]);
  const rootItemValues = useMemo(() => rootItems.map(({ item }) => item), [rootItems]);
  const rootItemIndexes = useMemo(() => rootItems.map(({ index }) => index), [rootItems]);
  const rootInsertIndex = getLaneRootInsertIndex(lane);

  const toggleIsCollapsed = useCallback(() => {
    stateManager.setState((board) => {
      const collapseState = [...view.getViewState('list-collapse')];
      collapseState[laneIndex] = !collapseState[laneIndex];
      view.setViewState('list-collapse', collapseState);
      return update(board, {
        data: { settings: { 'list-collapse': { $set: collapseState } } },
      });
    });
  }, [stateManager, laneIndex]);

  const addItems = useCallback(
    (items: Item[]) => {
      boardModifiers.insertItems(
        [...path, shouldPrepend ? 0 : getLaneRootInsertIndex(lane)],
        items.map((item) =>
          update(item, {
            data: {
              checked: {
                // Mark the item complete if we're moving into a completed lane
                $set: shouldMarkItemsComplete,
              },
              checkChar: {
                $set: shouldMarkItemsComplete ? getTaskStatusDone() : ' ',
              },
            },
          })
        )
      );

      // TODO: can we find a less brute force way to do this?
      view.getWindow().setTimeout(() => {
        const laneItems = elementRef.current?.getElementsByClassName(c('lane-items'));

        if (laneItems.length) {
          animateScrollTo([0, shouldPrepend ? 0 : laneItems[0].scrollHeight], {
            elementToScroll: laneItems[0],
            speed: 200,
            minDuration: 150,
            easing: (x: number) => {
              return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
            },
          });
        }
      });
    },
    [boardModifiers, path, lane, shouldPrepend, shouldMarkItemsComplete]
  );

  const DroppableComponent = isStatic ? StaticDroppable : Droppable;
  const SortableComponent = isStatic ? StaticSortable : Sortable;
  const CollapsedDropArea = !isCollapsed || isStatic ? Fragment : Droppable;
  const dropAreaProps: DraggableProps = useMemo(() => {
    if (!isCollapsed || isStatic) return {} as any;
    const data = {
      id: generateInstanceId(),
      type: 'lane',
      accepts: [DataTypes.Item],
      acceptsSort: [DataTypes.Lane],
    };
    return {
      elementRef: elementRef,
      measureRef: measureRef,
      id: data.id,
      index: laneIndex,
      data: data,
    };
  }, [isCollapsed, laneIndex, isStatic]);

  return (
    <SortContext.Provider value={lane.data.sorted ?? null}>
      <div
        ref={measureRef}
        className={classcat([
          c('lane-wrapper'),
          {
            'is-sorting': isSorting,
            'collapse-horizontal': isCollapsed && collapseDir === 'horizontal',
            'collapse-vertical': isCollapsed && collapseDir === 'vertical',
          },
        ])}
        style={laneStyles}
      >
        <div
          data-count={itemCount}
          ref={elementRef}
          className={classcat([c('lane'), { 'will-prepend': shouldPrepend }])}
        >
          <CollapsedDropArea {...dropAreaProps}>
            <LaneHeader
              bindHandle={bindHandle}
              laneIndex={laneIndex}
              lane={lane}
              setIsItemInputVisible={isCompactPrepend ? setEditState : undefined}
              isCollapsed={isCollapsed}
              toggleIsCollapsed={toggleIsCollapsed}
            />

            {!search?.query && !isCollapsed && shouldPrepend && (
              <ItemForm
                addItems={addItems}
                hideButton={isCompactPrepend}
                editState={editState}
                setEditState={setEditState}
              />
            )}

            {!isCollapsed && (
              <DroppableComponent
                elementRef={elementRef}
                measureRef={measureRef}
                id={lane.id}
                index={laneIndex}
                data={lane}
              >
                <ScrollContainer
                  className={classcat([c('lane-items'), c('vertical')])}
                  id={lane.id}
                  index={laneIndex}
                  isStatic={isStatic}
                  triggerTypes={laneAccepts}
                >
                  <SortableComponent onSortChange={setIsSorting} axis="vertical">
                    <Items
                      items={rootItemValues}
                      itemIndexes={rootItemIndexes}
                      isStatic={isStatic}
                      shouldMarkItemsComplete={shouldMarkItemsComplete}
                    />
                    <SortPlaceholder
                      accepts={laneAccepts}
                      index={rootInsertIndex}
                      isStatic={isStatic}
                    />
                  </SortableComponent>
                  {sections.map(({ section, index }) => (
                    <NestedSection
                      key={section.id}
                      section={section}
                      sectionIndex={index}
                      isStatic={isStatic}
                      laneShouldMarkItemsComplete={shouldMarkItemsComplete}
                    />
                  ))}
                </ScrollContainer>
              </DroppableComponent>
            )}

            {!search?.query && !isCollapsed && !shouldPrepend && (
              <ItemForm addItems={addItems} editState={editState} setEditState={setEditState} />
            )}

            {!isCollapsed && <LaneArchive items={lane.data.archive || []} />}
          </CollapsedDropArea>
        </div>
      </div>
    </SortContext.Provider>
  );
}

export const DraggableLane = memo(DraggableLaneRaw);

export interface LanesProps {
  lanes: Lane[];
  collapseDir: 'horizontal' | 'vertical';
}

function LanesRaw({ lanes, collapseDir }: LanesProps) {
  const search = useContext(SearchContext);
  const { view } = useContext(KanbanContext);
  const boardView = view.useViewState(frontmatterKey) || 'board';
  const collapseState = view.useViewState('list-collapse') || [];

  return (
    <>
      {lanes.map((lane, i) => {
        return (
          <DraggableLane
            collapseDir={collapseDir}
            isCollapsed={(search?.query && !search.lanes.has(lane)) || !!collapseState[i]}
            key={boardView + lane.id}
            lane={lane}
            laneIndex={i}
          />
        );
      })}
    </>
  );
}

export const Lanes = memo(LanesRaw);
