// Complaint management (Process #42, Domain E). Same shape as the six
// dictionaries that came before: one namespaced object per domain, every key
// prefixed so the merged flat namespace in ../translations.ts cannot collide,
// AR first and EN second, both hand-written rather than one translated from
// the other.
//
// Vocabulary follows what the existing dictionaries already established —
// شكوى (complaint), مطالبة (claim), عميل (customer), الحالة (status) — so a
// user moving between screens meets the same words for the same things.
export const COMPLAINTS = {
  AR: {
    complaintsHeading: 'الشكاوى',
    // TODO(arabic-terminology): "Insurance Dispute Resolution Committee" is
    // rendered here as لجنة تسوية المنازعات التأمينية — a provisional
    // best-effort, NOT a sourced name. No official CBJ Arabic name for the
    // body was available when this was written. If one turns up, replace it
    // verbatim here; it is the only place the name appears.
    complaintsIntro:
      'شكاوى العملاء، ويمكن ربط الشكوى بمطالبة محل نزاع. تُتابَع كل شكوى مقابل مهلة حل مستهدفة قدرها عشرة أيام عمل، وتُصعَّد الشكوى التي يتعذّر حلّها داخلياً إلى لجنة تسوية المنازعات التأمينية. ويتطلب الإغلاق اعتماد مشرف غير الشخص الذي قام بالحل.',

    // Log form
    complaintsCustomerIdLabel: 'العميل',
    complaintsIssueLabel: 'موضوع الشكوى',
    complaintsCategoryLabel: 'التصنيف (اختياري)',
    complaintsCategoryAria: 'التصنيف',
    complaintsClaimIdLabel: 'معرّف المطالبة محل النزاع (اختياري)',
    complaintsLogButton: 'تسجيل الشكوى',
    complaintsSavingButton: 'جارٍ الحفظ…',

    // Table
    complaintsColCustomer: 'العميل',
    complaintsColIssue: 'موضوع الشكوى',
    complaintsColStatus: 'الحالة',
    complaintsColSla: 'المهلة',
    complaintsColEscalations: 'التصعيدات',
    complaintsColAction: 'الإجراء',

    // Row actions
    complaintsDownloadAckButton: 'تنزيل إشعار الاستلام (PDF)',
    complaintsTextPlaceholder: 'معرّف المُسنَد إليه / الإجراء / الحل / السبب',
    complaintsTextAria: 'نص الشكوى {id}',
    complaintsAssignButton: 'إسناد',
    complaintsStartButton: 'بدء المعالجة',
    complaintsAddActionButton: 'إضافة إجراء',
    complaintsResolveButton: 'حل الشكوى',
    complaintsEscalateButton: 'تصعيد',
    complaintsCloseButton: 'إغلاق',

    // The four states
    complaintsLoading: 'جارٍ التحميل…',
    complaintsNone: 'لا توجد شكاوى مسجّلة بعد.',
    complaintsLoadError: 'تعذّر تحميل الشكاوى — حاول مرة أخرى.',
    complaintsNoPermission:
      'لا تملك صلاحية complaint.log اللازمة لعرض الشكاوى.',
    complaintsAckError: 'تعذّر إنشاء إشعار الاستلام — حاول مرة أخرى.',
    complaintsActionError: 'تعذّر تنفيذ الإجراء — حاول مرة أخرى.',

    // SLA
    complaintsSlaNone: '—',
    complaintsSlaResolved: 'تم الحل',
    complaintsSlaBreached: 'تجاوزت المهلة (تستحق {date})',
    complaintsSlaDue: 'تستحق {date}',

    // ComplaintStatus — rendered as a label, never as the raw enum token.
    complaintsStatusLogged: 'مُسجَّلة',
    complaintsStatusAssigned: 'مُسنَدة',
    complaintsStatusInProgress: 'قيد المعالجة',
    complaintsStatusEscalated: 'مُصعَّدة',
    complaintsStatusResolved: 'تم حلّها',
    complaintsStatusClosed: 'مغلقة',
  },
  EN: {
    complaintsHeading: 'Complaints',
    complaintsIntro:
      'Customer complaints, optionally linked to a claim under dispute. Each is tracked against a resolution SLA (a 10-business-day working target). A complaint that cannot be resolved internally is escalated to the Insurance Dispute Resolution Committee. Closure needs a supervisor sign-off by a different person than the one who resolved it.',

    complaintsCustomerIdLabel: 'Customer',
    complaintsIssueLabel: 'Issue',
    complaintsCategoryLabel: 'Category (optional)',
    complaintsCategoryAria: 'Category',
    complaintsClaimIdLabel: 'Disputed claim ID (optional)',
    complaintsLogButton: 'Log complaint',
    complaintsSavingButton: 'Saving…',

    complaintsColCustomer: 'Customer',
    complaintsColIssue: 'Issue',
    complaintsColStatus: 'Status',
    complaintsColSla: 'SLA',
    complaintsColEscalations: 'Escalations',
    complaintsColAction: 'Action',

    complaintsDownloadAckButton: 'Download acknowledgement (PDF)',
    complaintsTextPlaceholder: 'assignee id / action / resolution / reason',
    complaintsTextAria: 'Text for {id}',
    complaintsAssignButton: 'Assign',
    complaintsStartButton: 'Start',
    complaintsAddActionButton: 'Add action',
    complaintsResolveButton: 'Resolve',
    complaintsEscalateButton: 'Escalate',
    complaintsCloseButton: 'Close',

    complaintsLoading: 'Loading…',
    complaintsNone: 'No complaints.',
    complaintsLoadError: 'Could not load complaints — try again.',
    complaintsNoPermission: "You don't hold the complaint.log permission.",
    complaintsAckError: 'Could not generate the acknowledgement — try again.',
    complaintsActionError: 'That action failed — try again.',

    complaintsSlaNone: '—',
    complaintsSlaResolved: 'Resolved',
    complaintsSlaBreached: 'Breached (due {date})',
    complaintsSlaDue: 'Due {date}',

    complaintsStatusLogged: 'Logged',
    complaintsStatusAssigned: 'Assigned',
    complaintsStatusInProgress: 'In progress',
    complaintsStatusEscalated: 'Escalated',
    complaintsStatusResolved: 'Resolved',
    complaintsStatusClosed: 'Closed',
  },
} as const;
