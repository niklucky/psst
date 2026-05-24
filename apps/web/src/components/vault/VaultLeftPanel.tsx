import { useState } from 'react';
import { useKeyVault } from '../../context/KeyVaultContext';
import { trpc } from '../../trpc';

// ── Folder tree helpers ────────────────────────────────────────────────────

interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
}

interface FolderNode extends FolderRow {
  children: FolderNode[];
}

function buildTree(rows: FolderRow[]): FolderNode[] {
  const map = new Map<string, FolderNode>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: FolderNode[] = [];
  for (const node of map.values()) {
    if (node.parentId) {
      map.get(node.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function FolderItem({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: FolderNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const isSelected = selectedId === node.id;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <button
        onClick={() => onSelect(isSelected ? null : node.id)}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        className={`w-full flex items-center gap-1.5 pr-2 py-1 rounded text-sm text-left transition-colors ${
          isSelected
            ? 'bg-indigo-50 text-indigo-700 font-medium'
            : 'text-gray-700 hover:bg-gray-50'
        }`}
      >
        {hasChildren ? (
          <span
            className="text-gray-400 text-xs w-3 shrink-0"
            onClickCapture={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            {open ? '▾' : '▸'}
          </span>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="shrink-0">📁</span>
        <span className="truncate">{node.name}</span>
      </button>

      {open &&
        node.children.map((child) => (
          <FolderItem
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  vaultId: string;
  folderFilter: string | null;
  selectedTagIds: Set<string>;
  onFolderSelect: (id: string | null) => void;
  onTagToggle: (tagId: string) => void;
}

export function VaultLeftPanel({
  vaultId,
  folderFilter,
  selectedTagIds,
  onFolderSelect,
  onTagToggle,
}: Props) {
  const { session } = useKeyVault();
  const enabled = !!session && !!vaultId;

  const { data: folderRows } = trpc.folder.list.useQuery({ vaultId }, { enabled });
  const { data: tagList } = trpc.tag.list.useQuery({ vaultId }, { enabled });

  const tree = buildTree(folderRows ?? []);

  return (
    <aside className="w-52 shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
      {/* ── Folders ── */}
      <div className="flex-1 overflow-y-auto py-3 px-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 px-2 mb-1">
          Folders
        </p>

        {/* "All secrets" root entry */}
        <button
          onClick={() => onFolderSelect(null)}
          className={`w-full flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
            folderFilter === null
              ? 'bg-indigo-50 text-indigo-700 font-medium'
              : 'text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span>🗂️</span>
          <span>All secrets</span>
        </button>

        {tree.map((node) => (
          <FolderItem
            key={node.id}
            node={node}
            depth={0}
            selectedId={folderFilter}
            onSelect={onFolderSelect}
          />
        ))}

        {folderRows?.length === 0 && (
          <p className="px-2 mt-2 text-xs text-gray-400">No folders yet</p>
        )}
      </div>

      {/* ── Tags ── */}
      {tagList && tagList.length > 0 && (
        <div className="shrink-0 border-t border-gray-100 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Tags
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tagList.map((tag) => {
              const isSelected = selectedTagIds.has(tag.id);
              const colour = tag.colour ?? null;
              return (
                <button
                  key={tag.id}
                  onClick={() => onTagToggle(tag.id)}
                  style={
                    colour
                      ? {
                          backgroundColor: isSelected ? colour : `${colour}25`,
                          color: colour,
                          borderColor: colour,
                        }
                      : undefined
                  }
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                    isSelected && !colour
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : !isSelected && !colour
                        ? 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                        : ''
                  }`}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
