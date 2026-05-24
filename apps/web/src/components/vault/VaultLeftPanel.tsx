import { useEffect, useRef, useState } from 'react';
import { ContextMenu } from '../shared/ContextMenu';
import type { ContextMenuItem } from '../shared/ContextMenu';
import { TagsModal } from './TagsModal';
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

// ── Inline name input ──────────────────────────────────────────────────────

function InlineInput({
  initialValue,
  placeholder,
  onConfirm,
  onCancel,
}: {
  initialValue?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue ?? '');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      placeholder={placeholder ?? 'Folder name'}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const trimmed = value.trim();
          if (trimmed) onConfirm(trimmed);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        const trimmed = value.trim();
        if (trimmed) onConfirm(trimmed);
        else onCancel();
      }}
      onClick={(e) => e.stopPropagation()}
      className="flex-1 min-w-0 text-sm border border-indigo-400 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
    />
  );
}

// ── FolderItem ─────────────────────────────────────────────────────────────

interface FolderItemProps {
  node: FolderNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onNewSubfolder: (parentId: string, name: string) => void;
  onDropSecret: (secretId: string, folderId: string) => void;
}

function FolderItem({
  node,
  depth,
  selectedId,
  onSelect,
  onRename,
  onDelete,
  onNewSubfolder,
  onDropSecret,
}: FolderItemProps) {
  const [open, setOpen] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const isSelected = selectedId === node.id;
  const hasChildren = node.children.length > 0 || addingChild;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const menuItems: ContextMenuItem[] = [
    {
      label: 'Rename',
      icon: '✏️',
      onClick: () => setIsEditing(true),
    },
    {
      label: 'New subfolder',
      icon: '📁',
      onClick: () => {
        setOpen(true);
        setAddingChild(true);
      },
    },
    {
      label: 'Delete',
      icon: '🗑️',
      danger: true,
      onClick: () => onDelete(node.id),
    },
  ];

  return (
    <div>
      {/* Row */}
      <div
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        className={`group flex items-center gap-1.5 pr-2 py-1 rounded text-sm transition-colors ${
          dragOver
            ? 'bg-indigo-100 ring-1 ring-indigo-400'
            : isSelected
              ? 'bg-indigo-50 text-indigo-700'
              : 'text-gray-700 hover:bg-gray-50'
        }`}
        onContextMenu={handleContextMenu}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const secretId = e.dataTransfer.getData('text/plain');
          if (secretId) onDropSecret(secretId, node.id);
        }}
      >
        {/* Expand toggle */}
        <span
          className="text-gray-400 text-xs w-3 shrink-0 cursor-pointer select-none"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setOpen((o) => !o);
          }}
        >
          {hasChildren ? (open ? '▾' : '▸') : ''}
        </span>

        {/* Icon */}
        <span className="shrink-0 text-base">📁</span>

        {/* Name or inline editor */}
        {isEditing ? (
          <InlineInput
            initialValue={node.name}
            onConfirm={(name) => {
              onRename(node.id, name);
              setIsEditing(false);
            }}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          <button
            className={`flex-1 min-w-0 text-left truncate ${isSelected ? 'font-medium' : ''}`}
            onClick={() => onSelect(isSelected ? null : node.id)}
          >
            {node.name}
          </button>
        )}

        {/* Context menu trigger (visible on hover) */}
        {!isEditing && (
          <button
            onClick={handleContextMenu}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 text-base leading-none px-0.5"
            aria-label="Folder options"
          >
            ···
          </button>
        )}
      </div>

      {/* Inline add-child input */}
      {open && addingChild && (
        <div style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }} className="flex items-center gap-1.5 pr-2 py-1">
          <span className="w-3 shrink-0" />
          <span className="shrink-0">📁</span>
          <InlineInput
            placeholder="Subfolder name"
            onConfirm={(name) => {
              onNewSubfolder(node.id, name);
              setAddingChild(false);
            }}
            onCancel={() => setAddingChild(false)}
          />
        </div>
      )}

      {/* Children */}
      {open &&
        node.children.map((child) => (
          <FolderItem
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
            onNewSubfolder={onNewSubfolder}
            onDropSecret={onDropSecret}
          />
        ))}

      {/* Context menu portal */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
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
  const utils = trpc.useUtils();

  const { data: folderRows } = trpc.folder.list.useQuery({ vaultId }, { enabled });
  const { data: tagList } = trpc.tag.list.useQuery({ vaultId }, { enabled });

  const createFolderMutation = trpc.folder.create.useMutation({
    onSuccess: () => void utils.folder.list.invalidate({ vaultId }),
  });
  const renameFolderMutation = trpc.folder.rename.useMutation({
    onSuccess: () => void utils.folder.list.invalidate({ vaultId }),
  });
  const deleteFolderMutation = trpc.folder.delete.useMutation({
    onSuccess: () => {
      void utils.folder.list.invalidate({ vaultId });
      // Clear filter if the deleted folder was selected
      onFolderSelect(null);
    },
  });
  const updateSecretMutation = trpc.secret.update.useMutation({
    onSuccess: () => void utils.secret.list.invalidate({ vaultId }),
  });

  const tree = buildTree(folderRows ?? []);

  // ── Root-level new-folder state ────────────────────────────────────────
  const [addingRoot, setAddingRoot] = useState(false);
  const [showTagsModal, setShowTagsModal] = useState(false);

  // ── "All secrets" drag-over ────────────────────────────────────────────
  const [allDragOver, setAllDragOver] = useState(false);

  const handleCreateFolder = (name: string, parentId: string | null = null) => {
    void createFolderMutation.mutateAsync({ vaultId, name, parentId: parentId ?? undefined });
  };

  const handleRenameFolder = (folderId: string, name: string) => {
    void renameFolderMutation.mutateAsync({ folderId, name });
  };

  const handleDeleteFolder = (folderId: string) => {
    void deleteFolderMutation.mutateAsync({ folderId });
  };

  const handleDropSecret = (secretId: string, folderId: string | null) => {
    // null means "move to root" (clear folder). We cast because tRPC infers
    // nullable() as undefined — the server schema correctly accepts null.
    void updateSecretMutation.mutateAsync({
      secretId,
      folderId: folderId as string | undefined,
    });
  };

  return (
    <aside className="w-52 shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
      {/* ── Folders ── */}
      <div className="flex-1 overflow-y-auto py-3 px-2">
        {/* Header row: label + add button */}
        <div className="flex items-center justify-between px-2 mb-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Folders
          </p>
          <button
            onClick={() => setAddingRoot(true)}
            title="New folder"
            className="text-gray-400 hover:text-indigo-600 text-base leading-none transition-colors"
          >
            +
          </button>
        </div>

        {/* "All secrets" drop target */}
        <button
          onClick={() => onFolderSelect(null)}
          onDragOver={(e) => {
            e.preventDefault();
            setAllDragOver(true);
          }}
          onDragLeave={() => setAllDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setAllDragOver(false);
            const secretId = e.dataTransfer.getData('text/plain');
            if (secretId) handleDropSecret(secretId, null);
          }}
          className={`w-full flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
            allDragOver
              ? 'bg-indigo-100 ring-1 ring-indigo-400'
              : folderFilter === null
                ? 'bg-indigo-50 text-indigo-700 font-medium'
                : 'text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span>🗂️</span>
          <span>All secrets</span>
        </button>

        {/* Root-level inline new folder */}
        {addingRoot && (
          <div className="flex items-center gap-1.5 px-2 py-1">
            <span className="w-3 shrink-0" />
            <span className="shrink-0">📁</span>
            <InlineInput
              placeholder="Folder name"
              onConfirm={(name) => {
                handleCreateFolder(name, null);
                setAddingRoot(false);
              }}
              onCancel={() => setAddingRoot(false)}
            />
          </div>
        )}

        {/* Folder tree */}
        {tree.map((node) => (
          <FolderItem
            key={node.id}
            node={node}
            depth={0}
            selectedId={folderFilter}
            onSelect={onFolderSelect}
            onRename={handleRenameFolder}
            onDelete={handleDeleteFolder}
            onNewSubfolder={(parentId, name) => handleCreateFolder(name, parentId)}
            onDropSecret={handleDropSecret}
          />
        ))}

        {folderRows?.length === 0 && !addingRoot && (
          <p className="px-2 mt-2 text-xs text-gray-400">No folders yet</p>
        )}
      </div>

      {/* ── Tags ── */}
      <div className="shrink-0 border-t border-gray-100 p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Tags</p>
          <button
            onClick={() => setShowTagsModal(true)}
            title="Manage tags"
            className="text-xs text-gray-400 hover:text-indigo-600 transition-colors"
          >
            ⚙
          </button>
        </div>

        {tagList && tagList.length > 0 ? (
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
        ) : (
          <p className="text-xs text-gray-400">
            No tags.{' '}
            <button
              onClick={() => setShowTagsModal(true)}
              className="text-indigo-500 hover:underline"
            >
              Add one
            </button>
          </p>
        )}
      </div>

      {/* Tags modal */}
      {showTagsModal && (
        <TagsModal vaultId={vaultId} onClose={() => setShowTagsModal(false)} />
      )}
    </aside>
  );
}
