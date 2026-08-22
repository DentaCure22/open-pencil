import { tv } from 'tailwind-variants'

export interface BoardSwitcherUi {
  activeDot?: string
  boardIcon?: string
  clearButton?: string
  footer?: string
  footerPrimaryAction?: string
  footerSecondaryAction?: string
  manageAction?: string
  projectChildren?: string
  projectChevron?: string
  projectIcon?: string
  root?: string
  row?: string
  scrollArea?: string
  search?: string
  searchIcon?: string
  searchInput?: string
  secondaryText?: string
  sectionTitle?: string
}

const boardSwitcherStyles = tv({
  slots: {
    root: 'flex min-h-0 flex-1 flex-col',
    scrollArea: 'scrollbar-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2.5 pb-2',
    search:
      'border-chrome-control-border bg-chrome-control mt-2.5 flex h-9 items-center gap-2.5 rounded-[9px] border px-2.5 text-muted transition-[border-color,background-color,color,box-shadow] focus-within:border-component/40 focus-within:text-surface focus-within:ring-2 focus-within:ring-component/10',
    searchIcon: 'size-[15px] shrink-0 stroke-[1.6]',
    searchInput:
      'min-w-0 flex-1 border-none bg-transparent p-0 text-[12.5px] leading-none text-surface outline-none placeholder:text-muted/80 disabled:cursor-default disabled:text-muted/45 disabled:placeholder:text-muted/45',
    clearButton:
      'flex size-5 items-center justify-center rounded-[5px] text-muted transition-colors hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30 disabled:cursor-default disabled:text-muted/40 disabled:hover:bg-transparent',
    sectionTitle:
      'flex h-[22px] items-center px-1 text-[9.5px] font-semibold uppercase tracking-[0.02em] text-muted',
    row: 'group/browser-row relative flex min-h-8 w-full items-center gap-2 rounded-[7px] border border-transparent px-2 text-left text-[12px] text-surface transition-[border-color,background-color,color] hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35 disabled:cursor-default disabled:text-muted/45 disabled:hover:bg-transparent',
    boardIcon:
      'size-[14px] shrink-0 stroke-[1.5] text-muted transition-colors group-hover/browser-row:text-surface group-disabled/browser-row:text-muted/35',
    secondaryText: 'text-[9.5px] text-muted',
    activeDot: 'size-[5px] shrink-0 rounded-full bg-component ring-[3px] ring-component/10',
    projectChevron: 'size-3 shrink-0 stroke-[1.6] text-muted/70 transition-transform',
    projectIcon: 'size-[15px] shrink-0 stroke-[1.45] text-muted',
    projectChildren: 'relative ml-[21px] border-l border-border/70 pl-3',
    footer: 'flex h-12 shrink-0 items-center gap-1.5 border-t border-border/70 px-2.5',
    footerPrimaryAction:
      'flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[11px] font-medium text-surface transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30 disabled:cursor-default disabled:text-muted/45 disabled:hover:bg-transparent',
    footerSecondaryAction:
      'flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[11px] font-medium text-muted transition-colors hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30 disabled:cursor-default disabled:text-muted/45 disabled:hover:bg-transparent',
    manageAction:
      'ml-auto flex size-8 items-center justify-center rounded-[7px] text-muted transition-colors hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30 disabled:cursor-default disabled:text-muted/35 disabled:hover:bg-transparent'
  },
  variants: {
    active: {
      true: {
        row: 'border-border/70 bg-chrome-detail text-surface hover:bg-hover'
      },
      false: {}
    }
  },
  defaultVariants: {
    active: false
  }
})

export function useBoardSwitcherUI(overrides?: BoardSwitcherUi) {
  const cls = boardSwitcherStyles()

  return {
    activeDot: cls.activeDot({ class: overrides?.activeDot }),
    boardIcon: cls.boardIcon({ class: overrides?.boardIcon }),
    clearButton: cls.clearButton({ class: overrides?.clearButton }),
    footer: cls.footer({ class: overrides?.footer }),
    footerPrimaryAction: cls.footerPrimaryAction({ class: overrides?.footerPrimaryAction }),
    footerSecondaryAction: cls.footerSecondaryAction({ class: overrides?.footerSecondaryAction }),
    manageAction: cls.manageAction({ class: overrides?.manageAction }),
    projectChildren: cls.projectChildren({ class: overrides?.projectChildren }),
    projectChevron: cls.projectChevron({ class: overrides?.projectChevron }),
    projectIcon: cls.projectIcon({ class: overrides?.projectIcon }),
    root: cls.root({ class: overrides?.root }),
    row: (active: boolean) => boardSwitcherStyles({ active }).row({ class: overrides?.row }),
    scrollArea: cls.scrollArea({ class: overrides?.scrollArea }),
    search: cls.search({ class: overrides?.search }),
    searchIcon: cls.searchIcon({ class: overrides?.searchIcon }),
    searchInput: cls.searchInput({ class: overrides?.searchInput }),
    secondaryText: cls.secondaryText({ class: overrides?.secondaryText }),
    sectionTitle: cls.sectionTitle({ class: overrides?.sectionTitle })
  }
}
