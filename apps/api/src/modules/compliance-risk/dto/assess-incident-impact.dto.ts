import {
  IsBoolean,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  trimIfString,
} from '../../../common/dto.util';
import { DECLARATION_REASON_MIN_LENGTH } from '../../../common/declaration-reason';

/**
 * OWNER DECISION 56 — `POST /incidents/:id/assess-impact` COLLECTS THE ASSESSMENT.
 *
 * Her words: «لما أضغط ع زر تقييم الأثر بس بظهرلي إنه تم تقييم أثره وأنا كل الي عملته
 * ضغط ع الزر، ما قيّمت ولا عملت شي.» The route took NO BODY and wrote a bare
 * `impactAssessedAt`, so «تم تقييم الأثر» meant that a button had been pressed.
 *
 * ## THE THREE OUTPUTS ARE THE PROCEDURE'S, NOT A DESIGN
 *
 * `PRIV-SOP-09` step 4, the DPO's step, verbatim:
 *
 *     «تقييم ما إذا كان الحادث يمس بيانات شخصية، وتحديد فئات البيانات وعدد أصحاب
 *      البيانات المتأثرين تقريبياً»
 *
 * — whether it touches personal data, the data CATEGORIES, and the APPROXIMATE NUMBER of
 * affected subjects. Output: «تقييم أثر أولي». Two of the three are typed fields in
 * `PRIV-SRS-02`:
 *
 *     data_categories_affected   | Text    | Required once impact assessment is complete.
 *     subjects_affected_estimate | Integer | Required once impact assessment is complete.
 *
 * and the third is the step's own first clause. `PRIV-FRM-06` § II asks for them as
 * «الأنظمة / البيانات المتأثرة (وتصنيفها إن عُرف)» and «عدد أصحاب البيانات المتأثرين
 * تقريباً (إن أمكن تقديره)».
 *
 * ## IT IS NOT A SEVERITY WORD
 *
 * `severity` is a different field with its own rule («Initial rating by reporter/DPO»),
 * set at report time. The assessment is about SCOPE. Conflating them is the obvious wrong
 * turn and is why this is written down.
 *
 * ## THE CONDITIONAL RULE IS ENFORCED IN TWO PLACES AND THAT IS DELIBERATE
 *
 * The dictionary says *Required once impact assessment is complete*. This DTO makes all
 * three mandatory on the act, and `IncidentReport_impact_assessment_complete` makes a row
 * with `impactAssessedAt` set and the trio empty UNREPRESENTABLE. The CHECK is the half
 * that survives a later code path written by somebody who has not read this comment.
 *
 * ## WHAT IS DELIBERATELY ABSENT
 *
 * NO THRESHOLD. `PRIV-SOP-09`'s «أكثر من 100 عميل» appears inside its «مثال تطبيقي» — a
 * worked EXAMPLE — and nothing here or anywhere keys on 100. Whether an incident is
 * Material is `classify` and needs a DPO plus a Senior-Management co-sign; the procedure's
 * own escalation note says that when classification is in doubt the conservative reading
 * is assumed, which is a judgement and not an arithmetic rule.
 */
export class AssessIncidentImpactDto {
  /**
   * SOP-09 step 4's first clause. `false` is a real and useful answer — an incident that
   * touches no personal data still needs an assessment ON RECORD saying so, which is what
   * distinguishes "assessed, and it is not a privacy matter" from "never assessed".
   */
  @IsBoolean()
  touchesPersonalData!: boolean;

  /**
   * «الأنظمة / البيانات المتأثرة (وتصنيفها إن عُرف)» — PRIV-FRM-06 § II. Free text
   * because the dictionary types it Text: the categories an office needs to name are not
   * a closed list, and inventing one here would be writing a vocabulary the approved
   * dictionary declined to write.
   */
  @Transform(trimIfString)
  @IsString()
  @Length(DECLARATION_REASON_MIN_LENGTH, 2000, {
    message:
      `dataCategoriesAffected must be at least ${DECLARATION_REASON_MIN_LENGTH} ` +
      'characters — PRIV-SRS-02 requires it once the impact assessment is complete, and ' +
      'an empty assessment is what "assessed" must never mean',
  })
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `dataCategoriesAffected ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  dataCategoriesAffected!: string;

  /**
   * «عدد أصحاب البيانات المتأثرين تقريباً» — an Integer in the dictionary. ZERO IS
   * PERMITTED AND MEANINGFUL: an incident that affected nobody is an assessment result,
   * not a missing answer, and refusing 0 would force the DPO to record a number they do
   * not believe. The ceiling is this product's own `Int` bound rather than a guessed
   * business limit.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0, {
    message:
      'subjectsAffectedEstimate cannot be negative — a count of affected data subjects ' +
      'has no negative value, and 0 is a legitimate assessment result',
  })
  @Max(2147483647)
  subjectsAffectedEstimate!: number;
}
