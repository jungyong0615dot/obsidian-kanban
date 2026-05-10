import classcat from 'classcat';
import { memo, useContext, useEffect, useMemo, useState } from 'preact/compat';
import { t } from 'src/lang/helpers';

import { MarkdownClonedPreviewRenderer } from '../MarkdownRenderer/MarkdownRenderer';
import { ItemMetadata } from '../Item/MetadataTable';
import { DateAndTime, RelativeDate } from '../Item/DateAndTime';
import { InlineMetadata } from '../Item/InlineMetadata';
import { Tags } from '../Item/ItemContent';
import { KanbanContext, SearchContext } from '../context';
import { c, useGetDateColorFn } from '../helpers';
import { Item } from '../types';

interface LaneArchiveProps {
  items: Item[];
}

const LaneArchiveItem = memo(function LaneArchiveItem({
  item,
  searchQuery,
}: {
  item: Item;
  searchQuery?: string;
}) {
  const { stateManager, filePath } = useContext(KanbanContext);
  const getDateColor = useGetDateColorFn(stateManager);

  return (
    <div className={c('archive-item-wrapper')}>
      <div className={classcat([c('item'), c('archive-item')])}>
        <div className={c('item-content-wrapper')}>
          <div className={c('item-title-wrapper')}>
            <div className={c('item-title')}>
              <MarkdownClonedPreviewRenderer
                entityId={item.id}
                className={c('item-markdown')}
                markdownString={item.data.title}
                searchQuery={searchQuery}
              />
              <div className={c('item-metadata')}>
                <RelativeDate item={item} stateManager={stateManager} />
                <DateAndTime
                  item={item}
                  stateManager={stateManager}
                  filePath={filePath}
                  getDateColor={getDateColor}
                />
                <InlineMetadata item={item} stateManager={stateManager} />
                <Tags tags={item.data.metadata.tags} searchQuery={searchQuery} />
              </div>
            </div>
          </div>
          <ItemMetadata item={item} searchQuery={searchQuery} />
        </div>
      </div>
    </div>
  );
});

export const LaneArchive = memo(function LaneArchive({ items }: LaneArchiveProps) {
  const search = useContext(SearchContext);
  const [isOpen, setIsOpen] = useState(false);

  const visibleItems = useMemo(() => {
    if (!search?.query) {
      return items;
    }

    return items.filter((item) => search.items.has(item));
  }, [items, search]);

  useEffect(() => {
    if (search?.query && visibleItems.length) {
      setIsOpen(true);
    }
  }, [search?.query, visibleItems.length]);

  if (!items.length || (search?.query && !visibleItems.length)) {
    return null;
  }

  return (
    <details
      className={c('lane-archive')}
      open={isOpen}
      onToggle={(e) => setIsOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className={c('lane-archive-summary')}>
        <span>{t('Archive')}</span>
        <span className={c('lane-archive-count')}>{items.length}</span>
      </summary>
      <div className={c('lane-archive-items')}>
        {visibleItems.map((item) => {
          const isMatch = search?.query ? search.items.has(item) : false;
          return (
            <LaneArchiveItem
              key={item.id}
              item={item}
              searchQuery={isMatch ? search.query : undefined}
            />
          );
        })}
      </div>
    </details>
  );
});
