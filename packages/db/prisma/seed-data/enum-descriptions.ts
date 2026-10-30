/**
 * MODULE 0-ب CLOSE — the Arabic description for every member of the four enums item 0-ب added.
 *
 * ## THIS FILE IS THE EDITABLE HOME; THE MIGRATION WAS THE BOOTSTRAP
 *
 * `20261130100000_value_descriptions` creates the four tables and INSERTs these eleven rows, because
 * register entry 33 established that data arriving only through the seed never reaches a database
 * nobody reseeds — item (f)'s permission code was absent from dev for exactly that reason. But an
 * applied migration cannot be edited (its checksum is stored, and `db:checksums` fails on drift), so
 * the text needs a home somebody can correct. That is here, and the seed upserts from it.
 *
 * ## THE MEMBER IS THE ENUM TYPE IN THE DATABASE
 *
 * So a description for a member that does not exist is unrepresentable rather than merely wrong. The
 * one property that leaves for a guard is COMPLETENESS — every member has a row — which
 * `enum-descriptions.spec.ts` checks against the generated Prisma enums, and which the migration
 * asserts against `enum_range` as well.
 *
 * ## TWO OF THESE CARRY A LEGAL CONSEQUENCE AND WERE CHECKED AGAINST THE CODE
 *
 * `BROKER_REQUEST` and `SANCTION`, against `license-standing.config.ts`: the art. 14/c deemed
 * cancellation applies to a BROKER_REQUEST suspension ONLY, and whether it reaches an art. 21/b
 * sanction is unsettled in the text and is not inferred. Both lines say exactly that, so neither was
 * corrected. The owner's rule is that where a value carries no consequence the description SAYS so —
 * which is why `BrokerageKind`'s two lines state plainly that no guard reads the field.
 */

export interface EnumDescriptionSeed {
  member: string;
  descriptionAr: string;
}

export const BROKERAGE_KIND_DESCRIPTIONS: EnumDescriptionSeed[] = [
  {
    member: "DIRECT",
    descriptionAr:
      "وساطةٌ بين العميل وشركة التأمين، وهي عملُ مكاتب الوساطة في هذا النظام. بيانٌ يُسجَّل ولا يقرأه أيُّ فحصٍ أو حارس.",
  },
  {
    member: "REINSURANCE",
    descriptionAr:
      "وساطةٌ بين شركات التأمين وشركات إعادة التأمين. بيانٌ يُسجَّل ولا يقرأه أيُّ فحصٍ أو حارس. ولا يحمل هذا النظامُ نصّاً تنظيميّاً لوساطة إعادة التأمين، فلا يُعفي مَن يختاره من شيءٍ ولا يُلزِمه بشيء.",
  },
];

export const REGULATORY_ACTION_KIND_DESCRIPTIONS: EnumDescriptionSeed[] = [
  {
    member: "SUSPENSION",
    descriptionAr:
      "وقفُ الرخصة بفعلٍ من البنك المركزي. يُسجَّل بتاريخه ومستنده ولا يُعدَّل ولا يُحذَف بعد تسجيله، وحالةُ الرخصة تُستخرَج من هذه الأفعال ولا تُكتَب يداً.",
  },
  {
    member: "CANCELLATION",
    descriptionAr:
      "إلغاءُ الرخصة بفعلٍ من البنك المركزي. يُسجَّل بتاريخه ومستنده، ويبقى في السجل بعد أيِّ فعلٍ لاحق، لأنّ تاريخَ المكتب يُقرأ كاملاً لا آخرُه فقط.",
  },
  {
    member: "REINSTATEMENT",
    descriptionAr:
      "إعادةُ العمل بالرخصة بعد وقف. يُسجَّل بتاريخه ومستنده، ولا يمحو الوقفَ الذي سبقه.",
  },
];

export const REGULATORY_ACTION_BASIS_DESCRIPTIONS: EnumDescriptionSeed[] = [
  {
    member: "BROKER_REQUEST",
    descriptionAr:
      "الوقفُ جاء بطلبٍ من المكتب نفسِه وبموافقةٍ مسبقةٍ من البنك المركزي، وفق المادة (١٤/أ) من تعليمات رقم (٩) لسنة ٢٠٢٦. وإن امتدّ الوقفُ أكثرَ من سنتين تُعتبر الرخصةُ ملغاةً حكماً بمقتضى المادة (١٤/ج).",
  },
  {
    member: "SANCTION",
    descriptionAr:
      "الوقفُ جاء جزاءً من البنك المركزي، وفق المادة (٢١/ب). وسريانُ مدّة السنتين في المادة (١٤/ج) على هذه الحالة غيرُ محسومٍ في النصّ، والنظامُ لا يُقدِّره ولا يحتسبه.",
  },
];

export const INTEGRATION_METHOD_DESCRIPTIONS: EnumDescriptionSeed[] = [
  {
    member: "API",
    descriptionAr:
      "التبادلُ يجري آليّاً بين النظامين عبر وصلةٍ برمجية، ويلزم تسجيلُ عنوان الوصلة. ولا تُحفَظ في هذه السجلات أيُّ كلمةِ مرورٍ أو مفتاحِ دخول.",
  },
  {
    member: "PORTAL",
    descriptionAr:
      "العملُ يجري على بوّابة الشركة الإلكترونية، يدخل إليها موظفُ المكتب بنفسه. ولا يحفظ النظامُ بياناتِ دخولِ البوّابة.",
  },
  {
    member: "EMAIL",
    descriptionAr:
      "التبادلُ يجري بالبريد الإلكتروني مع الشركة، ويُسجَّل العنوانُ المعتمَد لذلك.",
  },
  {
    member: "MANUAL",
    descriptionAr:
      "لا ربطَ إلكترونيّاً مع الشركة: التبادلُ ورقيٌّ أو هاتفيٌّ أو تسليمٌ باليد، ويُسجَّل ما يجري كما يجري.",
  },
];
