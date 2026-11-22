import { familyOf, verbOf } from './permission-matrix';
import {
  type Language,
  translate,
  type TranslationKey,
} from '../i18n/translations';

/**
 * 🔴 OWNER DECISION 127 — THE ONE HOME FOR A PERMISSION'S NAME.
 *
 * «ما في رمز صلاحية يظهر للمستخدم في أي شاشة أو رسالة: لكل صلاحية اسم عربي قصير صريح مقتطَع من
 * شرحها.» No permission CODE is ever shown to a user; every permission carries a short plain
 * Arabic name, and the code stays inside the system as a reference — on `data-code` for the
 * tests, matched by search, never rendered.
 *
 * ## 196 names, and every one of them is HERS
 *
 *   * **21 family names** — `docs/decision-144-ratified-strings.md` §٢. A family is rendered
 *     «الاسم · الفعل», which that section's own heading states.
 *   * **172 single names** — the same annex §٣, rows as written.
 *   * **2 single names** come from `docs/decision-146-ratified-strings.md` INSTEAD of annex §٣
 *     rows 4 and 5: decision 146 corrected the descriptions those two names are sliced from, and
 *     146 says in its own words that the two names follow the corrected text.
 *   * **1 single name** is in no annex-144 row at all —
 *     `docs/decision-145-renewal-permission-words-and-attach-failure.md` ratified
 *     `license-renewal.declare`'s name BEFORE the code shipped.
 *
 * 175 singles + 21 families = 196, and 175 + the 59 codes a family row covers = the 234
 * catalogue codes. `permission-names.test.ts` re-slices all 196 from those three papers AT TEST
 * TIME and compares byte for byte, so this file is a copy that cannot drift rather than a second
 * home: a test holding its own copy of her Arabic would be the second home.
 *
 * ## ⛔ ENGLISH IS NOT RULED, AND NO ENGLISH NAME IS WRITTEN HERE
 *
 * Every paper above is Arabic. Decision 127 is about the Arabic reader, and nothing says what an
 * English reader should see — so English renders exactly what it rendered before: the code. That
 * is `permissionDisplayName`'s `language !== 'AR'` branch, and it is an EMPTY CELL reported to
 * the owner, not a decision taken here.
 *
 * ⚠️ A row here is a row she gave. This is not a place to add a name you derived.
 */

/** The 21 family names (annex 144 §٢). A family is its code minus the final segment. */
export const PERMISSION_FAMILY_NAMES: Readonly<Record<string, string>> = {
  branch: 'فروع المكتب',
  claim: 'المطالبات',
  customer: 'عميل',
  department: 'أقسام المكتب',
  document: 'سجل المستندات',
  'email.integration': 'بريد المكتب الرسمي',
  employee: 'سجلات الموظفين',
  endorsement: 'تعديلات الوثائق',
  'insurance-line': 'نوع تأمين',
  insurer: 'شركة تأمين',
  'needs-assessment': 'تقييم حاجات العميل',
  opportunity: 'الفرص',
  'payment-channel': 'وسائل الدفع المعتمَدة',
  policy: 'الوثائق',
  renewal: 'حالات التجديد',
  rfq: 'طلبات عروض الأسعار',
  'risk-profile': 'ملف الخطر',
  role: 'أدوار المكتب',
  'security-config': 'إعدادات الأمان',
  'sla.policy': 'مهلة خدمة',
  vendor: 'سجل المورّدين',
};

/** The 175 single names, in catalogue order (annex 144 §٣, plus decisions 146 and 145). */
export const PERMISSION_NAMES: Readonly<Record<string, string>> = {
  'lead.create': 'يسجّل عميلاً محتملاً جديداً',
  'lead.list.read': 'يرى قائمة العملاء المحتملين ويصنّفها',
  'lead.transition': 'ينقل العميل المحتمل من حالة إلى حالة',
  'prospect.capture': 'يحوّل عميلاً محتملاً إلى عميل مرتقب',
  'prospect.read': 'يقرأ ملفات العملاء المرتقبين',
  'customer.bulk-import': 'يُدخل ملف عملاء المكتب القديم دفعةً واحدة',
  'kyc.capture': 'يجمع بيانات اعرف-عميلك ومستنداتها',
  'ubo.record': 'يسجّل المالكين المستفيدين الحقيقيين',
  'screening.run': 'يشغّل فحص العقوبات ومكافحة غسل الأموال',
  'kyc.edd.trigger': 'يفتح مسار التحقّق المعزَّز',
  'kyc.approve': 'يعتمد ملف اعرف-عميلك ويُنشّط العميل',
  'kyc.review.schedule': 'يضبط مواعيد إعادة فحص العميل دورياً',
  'needs-assessment.approve': 'يعتمد تقييم حاجات العميل',
  'program.assemble': 'يبني البرنامج التأميني للعميل',
  'program.read': 'يقرأ البرامج التأمينية للعملاء',
  'cross-sell.read': 'يرى فرص البيع المتقاطع المرشَّحة',
  'cross-sell.detect': 'اكتشاف البيع المتقاطع للعميل',
  'cross-sell.convert': 'يحوّل فرصة بيع متقاطع',
  'up-sell.read': 'قراءة توصيات البيع الإضافي للعميل',
  'up-sell.detect': 'اكتشاف البيع الإضافي للعميل',
  'up-sell.convert': 'يحوّل توصية بيع إضافي',
  'interaction.log': 'يسجّل تواصلاً مع عميل',
  'customer.national-id.reveal': 'يكشف الرقم الوطني كاملاً للعميل',
  'customer.360-view.read': 'يفتح سجل العميل الكامل',
  'opportunity.set-target-threshold': 'يضبط الحدّ المالي للفرصة',
  'insurer.directory.read': 'يبحث في دليل الشركات عبر المكاتب',
  'insurer.master.read': 'يقرأ السجل العام لشركات التأمين',
  'insurer.form.map': 'يربط نموذج شركة التأمين الرسمي',
  'insurer.office-form.map': 'يربط نسخة هذا المكتب وحده من نموذج شركة',
  'insurer.company.link': 'تسجيل العمل مع شركة تأمين',
  'insurer.company.unlink': 'إنهاء العمل مع شركة تأمين',
  'rfq.insurer.update': 'يحدّث حالة رد شركة تأمين على طلب عرض الأسعار',
  'rfq.communication.log': 'يسجّل سؤالاً وارداً من شركة تأمين أو رداً صادراً',
  'quotation.capture': 'يسجّل عرض سعر وصل من شركة تأمين',
  'quotation.negotiate': 'يسجّل جولة تفاوض كنسخة جديدة من العرض',
  'quotation.read': 'يقرأ عروض شركات التأمين وتاريخ نسخها',
  'comparison.build': 'يبني مصفوفة مقارنة العروض',
  'comparison.read': 'يقرأ مصفوفة مقارنة عروض شركات التأمين',
  'recommendation.discard': 'يلغي توصية كُتبت بالخطأ قبل إرسالها للعميل',
  'recommendation.draft': 'يكتب توصية الوسيط',
  'recommendation.read': 'يقرأ التوصيات وحالة اعتمادها',
  'recommendation.approve': 'يعتمد توصية فوق الحدّ المالي',
  'recommendation.send': 'يرسل التوصية المعتمَدة للعميل',
  'conflict-of-interest.disclose': 'يسجّل إفصاح تضارب المصالح الإلزامي',
  'client-decision.capture': 'يسجّل قرار العميل على التوصية المرسلة',
  'client-decision.read': 'يقرأ قرار العميل ووجهة الفرصة بعده',
  'policy.discard': 'يلغي وثيقة أُنشئت بالخطأ قبل إصدارها',
  'policy.issue': 'يسجّل ما أصدرته شركة التأمين فعلاً',
  'policy.check': 'يفحص الوثيقة الصادرة بندًا بندًا',
  'policy.deliver': 'يسجّل تسليم الوثيقة',
  'endorsement.discard': 'يلغي تعديلاً طُلب بالخطأ قبل تنفيذه',
  'endorsement.apply': 'ينفّذ تعديل الوثيقة المؤكَّد',
  'cancellation.create': 'يطلب إلغاء وثيقة',
  'refund.raise': 'طلب استرداد',
  'refund.approve': 'يعتمد استرداد مبلغ عند الحدّ المقرَّر أو فوقه',
  'refund.disburse': 'يصرف الاسترداد المعتمَد',
  'commission-reversal.create': 'ارتجاع العمولة',
  'claim.discard': 'يلغي مطالبة سُجّلت بالخطأ',
  'claim.notify': 'يسجّل إشعار مطالبة جديدة',
  'claim.register': 'يسجّل المطالبة عند شركة التأمين',
  'claim.document': 'يرفق مستندات المطالبة المطلوبة',
  'claim.assess': 'يتابع المعاينة والتحقيق على المطالبة',
  'claim.followup.manage': 'يضبط تنبيهات متابعة المطالبة ومواعيدها',
  'claim.settle.approve': 'المعتمِد الأول لتسوية مطالبة',
  'claim.settle.second-approve': 'المعتمِد الثاني لتسوية كبيرة',
  'claim.close': 'يُغلق المطالبة بعد تأكيد استلام العميل للمبلغ',
  'claims-analytics.view': 'يرى معدّل الخسارة وتحليلات المطالبات',
  'invoice.create': 'يُصدر فاتورة قسط على عميل',
  'receipt.record': 'يسجّل قبض مبلغ من عميل',
  'remittance.record': 'يسجّل توريد مبلغ إلى شركة تأمين',
  'client-accounting.read': 'يرى ما لم يُقبَض من العملاء وأعماره',
  'insurer-accounting.read': 'يرى ما يستحقّ على المكتب لشركات التأمين',
  'commission.calculate': 'يطبّق نسبة العمولة من الجدول المعتمَد',
  'commission-rate.manage': 'يعدّل اتفاقية نسب العمولة نفسها أو جدولها',
  'commission-override.raise': 'يطلب تعديلاً يدوياً على عمولة',
  'commission-override.approve': 'يعتمد تعديلاً يدوياً على عمولة',
  'commission.reconcile': 'يطابق قيد عمولة مع كشف شركة التأمين',
  'reconciliation-exception.investigate':
    'يحقّق في فرق بين كشف البنك وسجلات النظام',
  'reconciliation-exception.resolve': 'يُغلق فرق مطابقة بعد معالجته',
  'financial-report.view': 'عرض التقرير المالي',
  'service-request.manage': 'ينفّذ طلب خدمة',
  'complaint.log': 'يسجّل شكوى عميل',
  'complaint.close': 'يُغلق شكوى',
  'complaint.escalate': 'يحوّل الشكوى إلى لجنة تسوية النزاعات التأمينية',
  'sla-dashboard.view': 'يرى تأخّر المكتب عن مواعيده',
  'communication.send': 'يرسل رسالة للعميل',
  'feedback.log': 'يسجّل ملاحظة أو رأي عميل',
  'retention-case.manage': 'يدير حالة محافظة على عميل',
  'aml.monitor': 'يتابع تنبيهات مراقبة الحركات المالية المشتبه بها',
  'aml.escalate': 'يرفع تنبيه نشاط مشتبه به إلى الجهة المختصة',
  'sanctions-pep.screen': 'فحص العقوبات',
  'license.manage': 'يدير سجل رخصة الوسيط التنظيمية وتواريخها',
  'legal-value.read': 'يقرأ الأرقام القانونية التي يحسب بها النظام',
  'legal-value.declare':
    'يُدخل للمكتب رقماً أحالته التعليمات إلى قرار لم يصدر بعد',
  'declared-act.article-15-d.declare':
    'يُقرّ بإرسال طلب عرض أسعار لأقل من ثلاث شركات تأمين',
  'license-renewal.declare': 'يُقرّ بأن ترخيص المكتب قيد التجديد',
  'compliance-calendar.manage': 'يدير تقويم الالتزام التنظيمي',
  'risk-register.manage': 'يدير سجل مخاطر المكتب',
  'pi-policy.manage': 'يدير سجل وثيقة المسؤولية المهنية للمكتب نفسه',
  'incident.report': 'يُبلّغ عن حادثة أمنية أو حادثة خصوصية',
  'incident.contain': 'ينفّذ إجراءات احتواء الحادثة فوراً',
  'incident.classify': 'يصنّف الحادثة جوهرية أو غير جوهرية',
  'incident.classification.co-sign':
    'يوقّع ثانياً على تصنيف حادثة بأنها جوهرية',
  'incident.senior-management.notify':
    'يسجّل أن الإدارة العليا أُبلغت بحادثة جوهرية',
  'incident.notify-regulator': 'يرسل إشعار الحادثة إلى الجهات الرقابية',
  'duty-segregation.mode.declare':
    'يعلن هل المكتب يفصل طرفَي العمليات التي تحتاج شخصين',
  'conflict-of-interest.register.read': 'قراءة سجل الإفصاح عن تضارب المصالح',
  'internal-controls.view': 'يرى تقرير الاعتمادات الذاتية',
  'internal-audit.record': 'يسجّل ملاحظة تدقيق داخلي على المكتب',
  'internal-audit.close': 'يُغلق ملاحظة تدقيق داخلي بعد معالجتها',
  'audit-log.read': 'يقرأ سجل التدقيق غير القابل للتعديل',
  'document-history.read': 'يقرأ تاريخ نسخ المستند ومسار اعتماده',
  'workflow-history.read': 'يقرأ تاريخ انتقال حالات سجلّ معيّن',
  'kpi-dashboard.view': 'يرى رقماً واحداً عن كل مجال في المكتب',
  'dashboard.sales.view': 'يرى خطّ المبيعات',
  'sales-target.manage': 'يضع أهداف المبيعات لكل موظف أو فريق ويعدّلها',
  'dashboard.policy.view': 'يرى حجم الدفتر',
  'dashboard.claims.view': 'يرى مطالبات المكتب المفتوحة وقيمتها المستحقة',
  'dashboard.financial.view': 'يرى الموقف التجاري للمكتب',
  'dashboard.compliance.view': 'يرى إخفاقات المكتب في الالتزام',
  'insurer-performance.view': 'يرى تقييم شركات التأمين على أربعة محاور',
  'employee-performance.view': 'يرى إنتاجية موظف باسمه',
  'dashboard.executive.view': 'عرض لوحة الإدارة التنفيذية',
  'portfolio-analysis.view': 'يرى أين يقع دفتر المكتب',
  'profitability-analysis.view': 'يرى ما يربح المكتب فعلاً',
  'planning-export.generate': 'يُصدِّر بيانات المحفظة والسوق إلى ملف للتخطيط',
  'employee.national-id.reveal':
    'يكشف الرقم الوطني كاملاً للموظف بتبريرٍ مكتوب',
  'training.record': 'يسجّل إتمام موظف للتوعية الأمنية',
  'deprovisioning.execute': 'ينفّذ قائمة سحب الوصول عند تغيّر حالة موظف',
  'information-asset.manage': 'يدير جرد أصول المعلومات بحسب المعيار الدولي',
  'dpa.approve': 'يعتمد اتفاقية معالجة بيانات من الدرجة العالية',
  'bcp-dr.manage': 'يدير خطط استمرارية العمل والتعافي من الكوارث',
  'kb.publish': 'ينشر مقالاً في قاعدة المعرفة لموظفي المكتب',
  'document.delete-override': 'تجاوز مُسجَّل لحذف مستند',
  'consent.manage': 'يسجّل موافقة العميل أو سحبها',
  'dsr.log': 'يسجّل طلب صاحب بيانات',
  'dsr.handle': 'يعمل على طلب صاحب البيانات كمسؤول مُسنَد إليه',
  'dsr.close': 'يُغلق طلب صاحب بيانات',
  'retention-schedule.update': 'تحديث جدول مدد الاحتفاظ',
  'retention-schedule.confirm': 'تأكيد المدد في جدول الاحتفاظ',
  'retention.extend': 'تمديدُ مدّةِ الاحتفاظِ بسجلّاتٍ بعينِها',
  'retention.archive.retrieve': 'استخراج سجل مؤرشف/محجوب',
  'retention.dispose.nominate': 'يرشّح دفعة إتلاف',
  'retention.dispose.approve': 'يعتمد دفعة إتلاف نهائياً',
  'legal-hold.manage': 'يضع حفظاً قانونياً على سجلات فلا تُتلَف',
  'cross-border-transfer.approve': 'يعتمد نقل بيانات شخصية خارج المملكة',
  'data-sharing.request': 'يطلب مشاركة بيانات مع طرف ثالث لحالة واحدة',
  'data-sharing.approve': 'يعتمد مشاركة بيانات مع طرف ثالث',
  'dpia.review': 'يراجع نتيجة تقييم أثر على حماية البيانات',
  'privacy-notice.read': 'يقرأ إشعار الخصوصية المنطبق على نقطة تواصل',
  'privacy-notice.publish': 'ينشر إشعار خصوصية بنسخة مُرقَّمة بلغتين',
  'ropa.manage': 'يدير سجل أنشطة المعالجة',
  'dpo-workspace.view': 'يرى مساحة عمل مسؤول حماية البيانات مجتمعة',
  'permission.read': 'يرى قائمة الصلاحيات التي يمكن إسنادها إلى دور',
  'user.manage': 'يُنشئ حسابات الدخول ويلغيها',
  'diagnostics.view': 'يرى نصّ الخطأ التقني الذي يرسله الخادم',
  'provider.office-state.read': 'قراءة حالة مكاتب الوساطة المسجَّلة',
  'provider.office.register': 'تسجيل مكتب وساطةٍ جديد',
  'provider.office.administrator.invite': 'دعوة المسؤول الأول لمكتب وساطة',
  'provider.insurance-company.administrator.invite':
    'دعوة المسؤول الأول لشركة تأمين',
  'provider.insurer.register': 'تسجيل شركة تأمين على المنصة',
  'access-recertification.cycle.start': 'يبدأ دورة مراجعة الصلاحيات',
  'access-recertification.review': 'يقرّر في بند مراجعة',
  'access-recertification.review.routine':
    'يجعل بنود المراجعة تُوزَّع على هذا الشخص أولاً',
  'encryption-key.read': 'يرى بيانات مفاتيح التشفير',
  'lead.all-owners.read': 'يرى العملاء المحتملين الذين يملكهم موظفون آخرون',
  'customer.all-owners.read': 'يفتح ملف أي عميل في المكتب ولو كان لموظف آخر',
  'customer-file.all-owners.read': 'يفتح الملف التجاري لأي عميل في المكتب',
  'policy.all-owners.read': 'يقرأ أي وثيقة في المكتب ولو لم تكن لعميله',
  'claim.all-owners.read': 'يرى كل مطالبات المكتب لا مطالبات عملائه وحدهم',
  'endorsement.all-owners.read':
    'يقرأ أي تعديل وثيقة في المكتب ولو لم يكن لعميله',
  'recommendation.all-owners.read':
    'يقرأ أي توصية وسيط في المكتب ولو لم يكتبها',
  'sla.holiday.create': 'يضيف عطلة رسمية إلى التقويم',
  'sla.policy.regulatory': 'يغيّر ادّعاء النظام بأن المهلة مطلوبة قانوناً',
  'sla.timer.pause': 'يوقف عدّاد مهلة مؤقتاً ويعيده',
};

/**
 * The verb word beside a family name — PROMOTED from `PermissionMatrix.tsx`, never copied.
 *
 * Annex 144 §٤ says a family permission written inside a text becomes «اسم العائلة · الفعل»
 * **«كما تُعرَض في المصفوفة»** — as the matrix displays it. So the matrix's own verb words are
 * the source, and a second map here would be a second home for that agreement.
 */
export const VERB_LABEL: Record<
  string,
  | 'roleVerbView'
  | 'roleVerbCreate'
  | 'roleVerbEdit'
  | 'roleVerbDelete'
  | 'roleVerbDeactivate'
  | 'roleVerbManage'
> = {
  read: 'roleVerbView',
  view: 'roleVerbView',
  create: 'roleVerbCreate',
  update: 'roleVerbEdit',
  delete: 'roleVerbDelete',
  deactivate: 'roleVerbDeactivate',
  manage: 'roleVerbManage',
};

/** The separator between a family name and its verb, as annex 144 §٢'s heading writes it. */
export const FAMILY_VERB_SEPARATOR = ' · ';

/**
 * A permission's Arabic name — the single name, or «family · verb», or the code.
 *
 * ⛔ ARABIC BY CONSTRUCTION, and the hard-coded `'AR'` is the point rather than an oversight.
 * These names are ratified in Arabic and English is unruled, so the verb half is resolved from
 * the Arabic dictionary too: a composed name is either wholly hers or it is not her name at all.
 * The callers that must respect the reader's language go through `permissionDisplayName`.
 *
 * The final fallback to the CODE is reachable: this is called with codes that arrive from the
 * API, and a code the catalogue has withdrawn between a page load and a render has no name. A
 * code is a poor answer and it is a true one; inventing a name would be neither.
 */
export function permissionNameAr(code: string): string {
  const own = PERMISSION_NAMES[code];
  if (own) return own;
  const family = PERMISSION_FAMILY_NAMES[familyOf(code)];
  if (!family) return code;
  const verbKey = VERB_LABEL[verbOf(code)];
  if (!verbKey) return family;
  return (
    family + FAMILY_VERB_SEPARATOR + translate('AR', verbKey as TranslationKey)
  );
}

/**
 * What a reader of THIS language is shown in place of the code.
 *
 * Arabic: her name. English: the code, unchanged — see the English note in this file's header.
 */
export function permissionDisplayName(
  code: string,
  language: Language,
): string {
  return language === 'AR' ? permissionNameAr(code) : code;
}

/**
 * A FAMILY's heading on the matrix — its ratified name, with the verbs rendered beside it as the
 * checkbox labels rather than joined into the heading.
 *
 * Separate from `permissionDisplayName` because a family is not a code: `branch` is not something
 * anybody can hold, and passing it to the code path would compose «فروع المكتب · <verb>» out of
 * `verbOf('branch')`, which is the whole string.
 */
export function familyDisplayName(family: string, language: Language): string {
  if (language !== 'AR') return family;
  return PERMISSION_FAMILY_NAMES[family] ?? family;
}

/** Every code whose name a search should match — used so an Arabic query finds an Arabic row. */
export function permissionSearchHaystack(
  code: string,
  language: Language,
  description: string | null,
): string {
  return [code, permissionDisplayName(code, language), description ?? '']
    .join(' ')
    .toLowerCase();
}
