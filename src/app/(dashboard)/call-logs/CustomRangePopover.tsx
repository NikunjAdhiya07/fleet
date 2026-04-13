"use client";

import { useCallback, useMemo, useState, memo } from "react";
import { format, startOfDay } from "date-fns";
import { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type DateFilter = "ALL" | "TODAY" | "YESTERDAY" | "CUSTOM";

type Props = {
  dateFilter: DateFilter;
  committedRange: DateRange | undefined;
  onApply: (range: DateRange | undefined) => void;
  onResetToToday: () => void;
};

function CustomRangePopoverInner({
  dateFilter,
  committedRange,
  onApply,
  onResetToToday,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setDraft(committedRange);
      }
      setOpen(next);
    },
    [committedRange]
  );

  const defaultMonth = useMemo(() => {
    if (draft?.from) return draft.from;
    return startOfDay(new Date());
  }, [draft?.from?.getTime()]);

  const applyAndClose = useCallback(() => {
    if (draft?.from) {
      onApply(draft);
    }
    setOpen(false);
  }, [draft, onApply]);

  const resetAndClose = useCallback(() => {
    onResetToToday();
    setOpen(false);
  }, [onResetToToday]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors min-w-[110px]",
            dateFilter === "CUSTOM"
              ? "bg-emerald-600 text-white"
              : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200",
            open && dateFilter !== "CUSTOM" && "ring-1 ring-emerald-500/40 ring-offset-2 ring-offset-slate-900"
          )}
        >
          <CalendarIcon className="w-3 h-3" />
          {dateFilter === "CUSTOM" && committedRange?.from ? (
            committedRange.to ? (
              <>
                {format(committedRange.from, "MMM d, y")} – {format(committedRange.to, "MMM d, y")}
              </>
            ) : (
              <>
                {format(committedRange.from, "MMM d, y")}
                <span className="opacity-80 font-normal"> · end date</span>
              </>
            )
          ) : (
            "Custom range"
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-fit max-w-[16.75rem] p-0 border-slate-800 bg-slate-950 shadow-xl"
        align="end"
        sideOffset={6}
      >
        <div className="border-b border-slate-800 px-3 py-2.5 space-y-0.5">
          <p className="text-xs font-semibold text-slate-200">Pick a date range</p>
          {draft?.from && (
            <p className="text-[11px] text-emerald-400/90 pt-1">
              {draft.to
                ? `Selected: ${format(draft.from, "MMM d, y")} → ${format(draft.to, "MMM d, y")}`
                : `Start: ${format(draft.from, "MMM d, y")} — pick end date (or same day again for one day)`}
            </p>
          )}
        </div>
        {open && (
          <Calendar
            mode="range"
            captionLayout="label"
            defaultMonth={defaultMonth}
            selected={draft}
            onSelect={setDraft}
            numberOfMonths={1}
            showOutsideDays={false}
            className="text-white bg-slate-950 border-slate-800 p-2 [--cell-size:2.25rem]"
          />
        )}
        <div className="border-t border-slate-800 px-3 py-2.5 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 text-xs bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700"
            onClick={resetAndClose}
          >
            Reset to today
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs bg-emerald-700 text-white hover:bg-emerald-600"
            disabled={!draft?.from}
            onClick={applyAndClose}
          >
            Apply range
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const CustomRangePopover = memo(CustomRangePopoverInner);
