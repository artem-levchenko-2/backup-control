"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Play,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  FolderSync,
  Database,
  ImagePlus,
  Copy,
  HelpCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { Job, JobType } from "@/lib/types";

// ── Job type config with descriptions ────────────────────────

const jobTypeConfig: Record<JobType, {
  label: string;
  icon: React.ElementType;
  color: string;
  description: string;
}> = {
  rclone_copy: {
    label: "Rclone Copy",
    icon: Copy,
    color: "text-blue-500",
    description: "Copies files from source to destination, skipping already existing files. Never deletes files at the destination. Safe default choice.",
  },
  rclone_sync: {
    label: "Rclone Sync",
    icon: FolderSync,
    color: "text-indigo-500",
    description: "Makes destination identical to source. WARNING: Deletes files at destination that don't exist at source. Use with caution.",
  },
  immich_db_backup: {
    label: "Immich DB Backup",
    icon: Database,
    color: "text-orange-500",
    description: "Backs up the Immich PostgreSQL database dump files. Critical for disaster recovery — the database can't be regenerated from photos.",
  },
  immich_go_import: {
    label: "Immich-go Import",
    icon: ImagePlus,
    color: "text-pink-500",
    description: "Bulk import photos and videos into Immich using the immich-go CLI tool. Supports large libraries with duplicate detection.",
  },
};

// ── Rclone flags with descriptions ───────────────────────────

interface FlagDef {
  flag: string;
  label: string;
  description: string;
  hasValue?: boolean;
  placeholder?: string;
  defaultValue?: string;
}

const RCLONE_FLAGS: FlagDef[] = [
  {
    flag: "--checksum",
    label: "Checksum",
    description: "Compare files by checksum (SHA1/MD5) instead of modification time and size. More accurate but slower on first run.",
  },
  {
    flag: "--transfers",
    label: "Parallel transfers",
    description: "Number of file transfers to run in parallel. Higher values speed up many small files. Default is 4.",
    hasValue: true,
    placeholder: "4",
    defaultValue: "4",
  },
  {
    flag: "--checkers",
    label: "Parallel checkers",
    description: "Number of checkers to run in parallel for comparing files. Default is 8.",
    hasValue: true,
    placeholder: "8",
    defaultValue: "8",
  },
  {
    flag: "--no-update-modtime",
    label: "Don't update modtime",
    description: "Don't update modification time on destination files. Useful when destination doesn't support modtime.",
  },
  {
    flag: "--dry-run",
    label: "Dry run (preview only)",
    description: "Preview what would be transferred without actually copying any files. Perfect for testing new jobs.",
  },
  {
    flag: "--exclude",
    label: "Exclude pattern",
    description: "Skip files matching this glob pattern. Examples: 'thumbs/**' or '*.tmp'. You can add multiple by separating with space.",
    hasValue: true,
    placeholder: "thumbs/** encoded-video/**",
  },
  {
    flag: "--min-size",
    label: "Min file size",
    description: "Skip files smaller than this size. Useful to exclude tiny/empty files. Examples: 1K, 100M, 1G.",
    hasValue: true,
    placeholder: "1K",
  },
  {
    flag: "--max-size",
    label: "Max file size",
    description: "Skip files larger than this size. Useful to avoid transferring huge files. Examples: 100M, 1G, 5G.",
    hasValue: true,
    placeholder: "1G",
  },
  {
    flag: "--ignore-existing",
    label: "Ignore existing",
    description: "Skip all files that already exist on destination, regardless of modification time or size. Fastest for append-only backups.",
  },
  {
    flag: "--verbose",
    label: "Verbose logging",
    description: "Show extra debug information in logs. Useful for troubleshooting transfer issues.",
  },
];

// ── Schedule helpers ─────────────────────────────────────────

type ScheduleFreq = "daily" | "every_hours" | "weekly" | "custom";

interface ParsedSchedule {
  freq: ScheduleFreq;
  hour: string;
  minute: string;
  interval: string;
  weekday: string;
  customText: string;
}

function parseSchedule(raw: string): ParsedSchedule {
  const defaults: ParsedSchedule = {
    freq: "daily", hour: "02", minute: "00",
    interval: "6", weekday: "mon", customText: raw,
  };

  if (!raw) return defaults;

  // "daily HH:MM"
  const dailyMatch = raw.match(/^daily\s+(\d{1,2}):(\d{2})$/i);
  if (dailyMatch) {
    return { ...defaults, freq: "daily", hour: dailyMatch[1].padStart(2, "0"), minute: dailyMatch[2] };
  }

  // "every Nh"
  const everyMatch = raw.match(/^every\s+(\d+)h$/i);
  if (everyMatch) {
    return { ...defaults, freq: "every_hours", interval: everyMatch[1] };
  }

  // "weekly DAY HH:MM"
  const weeklyMatch = raw.match(/^weekly\s+(\w+)\s+(\d{1,2}):(\d{2})$/i);
  if (weeklyMatch) {
    return { ...defaults, freq: "weekly", weekday: weeklyMatch[1].toLowerCase(), hour: weeklyMatch[2].padStart(2, "0"), minute: weeklyMatch[3] };
  }

  return { ...defaults, freq: "custom", customText: raw };
}

function buildSchedule(p: ParsedSchedule): string {
  switch (p.freq) {
    case "daily": return `daily ${p.hour}:${p.minute}`;
    case "every_hours": return `every ${p.interval}h`;
    case "weekly": return `weekly ${p.weekday} ${p.hour}:${p.minute}`;
    case "custom": return p.customText;
  }
}

// ── Flags helpers ────────────────────────────────────────────

interface FlagState {
  enabled: boolean;
  value: string;
}

function parseFlagsString(raw: string): Record<string, FlagState> {
  const state: Record<string, FlagState> = {};
  for (const def of RCLONE_FLAGS) {
    state[def.flag] = { enabled: false, value: def.defaultValue || "" };
  }

  if (!raw) return state;

  // Parse the flags string
  const parts = raw.split(/\s+/);
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    const def = RCLONE_FLAGS.find(f => f.flag === part);
    if (def) {
      if (def.hasValue && i + 1 < parts.length) {
        // Special case: --exclude can have multiple values
        if (def.flag === "--exclude") {
          // Collect all non-flag tokens as the value
          const values: string[] = [];
          i++;
          while (i < parts.length && !parts[i].startsWith("--")) {
            values.push(parts[i]);
            i++;
          }
          state[def.flag] = { enabled: true, value: values.join(" ") };
          continue;
        }
        state[def.flag] = { enabled: true, value: parts[i + 1] };
        i += 2;
        continue;
      }
      state[def.flag] = { enabled: true, value: def.defaultValue || "" };
    }
    i++;
  }

  return state;
}

function buildFlagsString(state: Record<string, FlagState>): string {
  const parts: string[] = [];
  for (const def of RCLONE_FLAGS) {
    const s = state[def.flag];
    if (!s?.enabled) continue;
    if (def.hasValue && s.value) {
      if (def.flag === "--exclude") {
        // Each exclude pattern gets its own --exclude flag
        const patterns = s.value.split(/\s+/).filter(Boolean);
        for (const p of patterns) {
          parts.push(`--exclude ${p}`);
        }
      } else {
        parts.push(`${def.flag} ${s.value}`);
      }
    } else if (!def.hasValue) {
      parts.push(def.flag);
    }
  }
  return parts.join(" ");
}

// ── Hours / minutes for dropdowns ────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];
const INTERVALS = ["1", "2", "3", "4", "6", "8", "12"];
const WEEKDAYS = [
  { value: "mon", label: "Monday" },
  { value: "tue", label: "Tuesday" },
  { value: "wed", label: "Wednesday" },
  { value: "thu", label: "Thursday" },
  { value: "fri", label: "Friday" },
  { value: "sat", label: "Saturday" },
  { value: "sun", label: "Sunday" },
];

// ── Empty job template ───────────────────────────────────────

const emptyJob: Partial<Job> = {
  name: "",
  type: "rclone_copy",
  enabled: 1,
  source_path: "",
  destination_path: "",
  schedule: "daily 02:00",
  flags: "",
  description: "",
};

// ═════════════════════════════════════════════════════════════
// Component
// ═════════════════════════════════════════════════════════════

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Partial<Job>>(emptyJob);
  const [isEdit, setIsEdit] = useState(false);
  const [runningJobs, setRunningJobs] = useState<Set<number>>(new Set());

  // Schedule state (parsed from editingJob.schedule)
  const [schedule, setSchedule] = useState<ParsedSchedule>(parseSchedule("daily 02:00"));
  // Flags state (parsed from editingJob.flags)
  const [flagsState, setFlagsState] = useState<Record<string, FlagState>>(parseFlagsString(""));

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs");
      const data = await res.json();
      setJobs(data);
    } catch (e) {
      console.error("Failed to fetch jobs", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleToggle = async (id: number) => {
    try {
      await fetch(`/api/jobs/${id}`, { method: "PATCH" });
      fetchJobs();
    } catch {
      toast.error("Failed to toggle job");
    }
  };

  const handleRunNow = async (id: number, name: string) => {
    try {
      setRunningJobs((prev) => new Set(prev).add(id));
      const res = await fetch(`/api/jobs/${id}/run`, { method: "POST" });
      const data = await res.json();
      toast.success(data.message || `Job "${name}" started`);
      setTimeout(() => {
        setRunningJobs((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        fetchJobs();
      }, 8000);
    } catch {
      toast.error("Failed to start job");
      setRunningJobs((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete job "${name}"? This will also delete all run history.`)) return;
    try {
      await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      toast.success(`Job "${name}" deleted`);
      fetchJobs();
    } catch {
      toast.error("Failed to delete job");
    }
  };

  const openCreate = () => {
    setEditingJob({ ...emptyJob });
    setSchedule(parseSchedule("daily 02:00"));
    setFlagsState(parseFlagsString(""));
    setIsEdit(false);
    setDialogOpen(true);
  };

  const openEdit = (job: Job) => {
    setEditingJob({ ...job });
    setSchedule(parseSchedule(job.schedule));
    setFlagsState(parseFlagsString(job.flags));
    setIsEdit(true);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      ...editingJob,
      schedule: buildSchedule(schedule),
      flags: buildFlagsString(flagsState),
    };

    try {
      if (isEdit && editingJob.id) {
        await fetch(`/api/jobs/${editingJob.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast.success("Job updated");
      } else {
        await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast.success("Job created");
      }
      setDialogOpen(false);
      fetchJobs();
    } catch {
      toast.error("Failed to save job");
    }
  };

  const updateSchedule = (partial: Partial<ParsedSchedule>) => {
    setSchedule((prev) => ({ ...prev, ...partial }));
  };

  const toggleFlag = (flag: string) => {
    setFlagsState((prev) => ({
      ...prev,
      [flag]: { ...prev[flag], enabled: !prev[flag]?.enabled },
    }));
  };

  const setFlagValue = (flag: string, value: string) => {
    setFlagsState((prev) => ({
      ...prev,
      [flag]: { ...prev[flag], value },
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Backup Jobs</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage your backup and import jobs
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchJobs}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" />
              New Job
            </Button>
          </div>
        </div>

        {/* Jobs Grid */}
        <div className="grid gap-4 md:grid-cols-2">
          {jobs.map((job) => {
            const cfg = jobTypeConfig[job.type] || jobTypeConfig.rclone_copy;
            const Icon = cfg.icon;
            const isRunning = runningJobs.has(job.id);

            return (
              <Card key={job.id} className={`relative transition-all ${!job.enabled ? "opacity-60" : ""}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-accent">
                        <Icon className={`w-4 h-4 ${cfg.color}`} />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-sm truncate">{job.name}</CardTitle>
                        <Badge variant="outline" className="text-[10px] mt-1">{cfg.label}</Badge>
                      </div>
                    </div>
                    <Switch
                      checked={!!job.enabled}
                      onCheckedChange={() => handleToggle(job.id)}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {job.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{job.description}</p>
                  )}
                  <div className="space-y-1.5 text-xs">
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-20 flex-shrink-0">Source:</span>
                      <span className="font-mono truncate">{job.source_path}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-20 flex-shrink-0">Destination:</span>
                      <span className="font-mono truncate">{job.destination_path}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-20 flex-shrink-0">Schedule:</span>
                      <span>{job.schedule}</span>
                    </div>
                    {job.flags && (
                      <div className="flex gap-2">
                        <span className="text-muted-foreground w-20 flex-shrink-0">Flags:</span>
                        <span className="font-mono text-[11px] truncate">{job.flags}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1"
                      disabled={isRunning || !job.enabled}
                      onClick={() => handleRunNow(job.id, job.name)}
                    >
                      {isRunning ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                          Running...
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 mr-1.5" />
                          Run Now
                        </>
                      )}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEdit(job)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleDelete(job.id, job.name)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {jobs.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No jobs yet. Create your first backup job!</p>
          </div>
        )}

        {/* ── Create/Edit Dialog ────────────────────────────── */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{isEdit ? "Edit Job" : "Create New Job"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 py-2">

              {/* Job Name */}
              <div className="space-y-2">
                <Label>Job Name</Label>
                <Input
                  value={editingJob.name || ""}
                  onChange={(e) => setEditingJob({ ...editingJob, name: e.target.value })}
                  placeholder="e.g. Nextcloud Datadir → Google Drive"
                />
              </div>

              {/* Job Type with descriptions */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label>Job Type</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">Determines what command runs. Most backups use &quot;Rclone Copy&quot;.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(jobTypeConfig) as [JobType, typeof jobTypeConfig[JobType]][]).map(([key, cfg]) => {
                    const Icon = cfg.icon;
                    const isSelected = editingJob.type === key;
                    return (
                      <Tooltip key={key}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setEditingJob({ ...editingJob, type: key })}
                            className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all text-sm ${
                              isSelected
                                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                                : "border-border/50 hover:bg-accent/50"
                            }`}
                          >
                            <Icon className={`w-4 h-4 flex-shrink-0 ${cfg.color}`} />
                            <span className={`text-xs ${isSelected ? "font-medium" : ""}`}>{cfg.label}</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[280px]">
                          <p className="text-xs">{cfg.description}</p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>

              {/* Source Path */}
              <div className="space-y-2">
                <Label>Source Path</Label>
                <Input
                  value={editingJob.source_path || ""}
                  onChange={(e) => setEditingJob({ ...editingJob, source_path: e.target.value })}
                  placeholder="/mnt/toshiba/nextcloud-data"
                  className="font-mono text-sm"
                />
              </div>

              {/* Destination Path */}
              <div className="space-y-2">
                <Label>Destination Path</Label>
                <Input
                  value={editingJob.destination_path || ""}
                  onChange={(e) => setEditingJob({ ...editingJob, destination_path: e.target.value })}
                  placeholder="gdrive:backups/nextcloud"
                  className="font-mono text-sm"
                />
              </div>

              {/* ── Schedule Picker ─────────────────────────── */}
              <div className="space-y-3">
                <Label>Schedule</Label>
                <div className="space-y-3 p-3 rounded-lg border border-border/50 bg-accent/20">
                  {/* Frequency */}
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground w-20 flex-shrink-0">Frequency</Label>
                    <Select
                      value={schedule.freq}
                      onValueChange={(v) => updateSchedule({ freq: v as ScheduleFreq })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Every day</SelectItem>
                        <SelectItem value="every_hours">Every N hours</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="custom">Custom (text)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Daily: time picker */}
                  {schedule.freq === "daily" && (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground w-20 flex-shrink-0">Time</Label>
                      <Select value={schedule.hour} onValueChange={(v) => updateSchedule({ hour: v })}>
                        <SelectTrigger className="h-8 w-20 text-xs font-mono">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {HOURS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground">:</span>
                      <Select value={schedule.minute} onValueChange={(v) => updateSchedule({ minute: v })}>
                        <SelectTrigger className="h-8 w-20 text-xs font-mono">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MINUTES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Every N hours */}
                  {schedule.freq === "every_hours" && (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground w-20 flex-shrink-0">Interval</Label>
                      <span className="text-xs text-muted-foreground">Every</span>
                      <Select value={schedule.interval} onValueChange={(v) => updateSchedule({ interval: v })}>
                        <SelectTrigger className="h-8 w-20 text-xs font-mono">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INTERVALS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <span className="text-xs text-muted-foreground">hours</span>
                    </div>
                  )}

                  {/* Weekly: day + time */}
                  {schedule.freq === "weekly" && (
                    <>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground w-20 flex-shrink-0">Day</Label>
                        <Select value={schedule.weekday} onValueChange={(v) => updateSchedule({ weekday: v })}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {WEEKDAYS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground w-20 flex-shrink-0">Time</Label>
                        <Select value={schedule.hour} onValueChange={(v) => updateSchedule({ hour: v })}>
                          <SelectTrigger className="h-8 w-20 text-xs font-mono">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {HOURS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <span className="text-muted-foreground">:</span>
                        <Select value={schedule.minute} onValueChange={(v) => updateSchedule({ minute: v })}>
                          <SelectTrigger className="h-8 w-20 text-xs font-mono">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MINUTES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}

                  {/* Custom */}
                  {schedule.freq === "custom" && (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground w-20 flex-shrink-0">Value</Label>
                      <Input
                        value={schedule.customText}
                        onChange={(e) => updateSchedule({ customText: e.target.value })}
                        placeholder="e.g. cron 0 2 * * *"
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                  )}

                  {/* Preview */}
                  <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/30">
                    Stored as: <code className="bg-accent px-1 rounded">{buildSchedule(schedule)}</code>
                  </p>
                </div>
              </div>

              {/* ── Flags (checkboxes with tooltips) ────────── */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5">
                  <Label>Rclone Flags</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">Extra command-line flags passed to rclone. Hover each option for details.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="space-y-2 p-3 rounded-lg border border-border/50 bg-accent/20">
                  {RCLONE_FLAGS.map((def) => {
                    const state = flagsState[def.flag];
                    return (
                      <div key={def.flag} className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={`flag-${def.flag}`}
                            checked={state?.enabled || false}
                            onCheckedChange={() => toggleFlag(def.flag)}
                          />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <label
                                htmlFor={`flag-${def.flag}`}
                                className="text-xs cursor-pointer flex items-center gap-1.5 select-none"
                              >
                                {def.label}
                                <HelpCircle className="w-3 h-3 text-muted-foreground" />
                              </label>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-[280px]">
                              <p className="text-xs font-medium mb-1 font-mono">{def.flag}</p>
                              <p className="text-xs">{def.description}</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        {/* Value input for flags that need it */}
                        {def.hasValue && state?.enabled && (
                          <Input
                            value={state.value}
                            onChange={(e) => setFlagValue(def.flag, e.target.value)}
                            placeholder={def.placeholder}
                            className="h-7 text-xs font-mono ml-6 w-auto"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={editingJob.description || ""}
                  onChange={(e) => setEditingJob({ ...editingJob, description: e.target.value })}
                  placeholder="Describe what this job does..."
                  rows={2}
                />
              </div>

            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave}>
                {isEdit ? "Save Changes" : "Create Job"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
