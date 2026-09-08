// Part F — Bilingual UI, full-app translation (post-item-#8 follow-up).
// Shared strings reused across many screens — generic verbs/labels, common
// loading/empty/error copy shapes. Domain-specific strings live in their own
// file in this directory (leads.ts, customers.ts, ...), merged into one
// `TranslationKey` union by ../translations.ts. Keyed by a semantic name
// (never by the English phrase itself), the same convention the original
// 6-key dictionary established.
export const COMMON = {
  AR: {
    commonLoading: 'جارٍ التحميل…',
    commonSave: 'حفظ',
    commonCancel: 'إلغاء',
    commonSearch: 'بحث',
    commonSearchPlaceholder: 'الاسم، بالعربية أو الإنجليزية',
    commonEdit: 'تعديل',
    commonDelete: 'حذف',
    commonClose: 'إغلاق',
    commonBack: 'رجوع',
    commonSubmit: 'إرسال',
    commonNext: 'التالي',
    commonYes: 'نعم',
    commonNo: 'لا',
    commonOptional: 'اختياري',
    commonRequired: 'إلزامي',
    commonActions: 'الإجراءات',
    commonStatus: 'الحالة',
    commonNoPermissionGeneric: 'لا تملك الصلاحية اللازمة لعرض هذا المحتوى.',
    commonTryAgain: 'تعذر تحميل البيانات — حاول مرة أخرى.',
  },
  EN: {
    commonLoading: 'Loading…',
    commonSave: 'Save',
    commonCancel: 'Cancel',
    commonSearch: 'Search',
    commonSearchPlaceholder: 'Name, in Arabic or English',
    commonEdit: 'Edit',
    commonDelete: 'Delete',
    commonClose: 'Close',
    commonBack: 'Back',
    commonSubmit: 'Submit',
    commonNext: 'Next',
    commonYes: 'Yes',
    commonNo: 'No',
    commonOptional: 'Optional',
    commonRequired: 'Required',
    commonActions: 'Actions',
    commonStatus: 'Status',
    commonNoPermissionGeneric: "You don't hold the permission required to view this.",
    commonTryAgain: 'Could not load this — try again.',
  },
} as const;
