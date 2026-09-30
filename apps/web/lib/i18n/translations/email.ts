// /settings/email — the office's own corporate mailbox.
//
// Wording notes that carry weight here:
//
//  * The DEPLOYMENT GAP is stated in the reader's own terms, never as environment variables. Those
//    reach the System/Security Administrator only (frontend directive § 2: internal implementation
//    detail is not shown to other roles). What everybody else needs to know is that it is not
//    theirs to fix.
//  * The TEST sends to the office's OWN mailbox, and the copy says so — otherwise an administrator
//    waits for a message in the wrong inbox and concludes the send failed.
//  * A CREDENTIAL REJECTION is the provider withdrawing consent, not a fault in this system, and
//    the copy names the remedy (connect again) rather than describing a token.
export const EMAIL = {
  AR: {
    emailHeading: 'بريد المكتب',
    emailIntro:
      'يرسل النظام رسائله من صندوق بريد مكتبك نفسه، لا من عنوان تابع للمنصة. ' +
      'اربط الصندوق هنا مرة واحدة، ثم تحقق منه أو اختبره وقت الحاجة.',
    emailLoading: 'جارٍ التحميل…',
    emailRefusalAct: 'عرض إعداد بريد المكتب',
    emailLoadFailed: 'تعذر قراءة حالة بريد المكتب — حاول مرة أخرى.',
    emailStatusHeading: 'الحالة',
    emailConnectedTo: 'الصندوق المربوط: {address}',
    emailProviderLabel: 'المزوّد',
    emailProviderMicrosoft: 'Microsoft 365',
    emailProviderGoogle: 'Google Workspace',
    emailLastSucceeded: 'آخر إرسال ناجح:',
    emailNeverSent: 'لم يُرسل شيء بعد',
    emailLastError: 'آخر رفض من المزوّد: {detail}',
    emailEmptyWithAction:
      'لم يُربط أي صندوق بريد. اربط صندوق مكتبك ليتمكن النظام من الإرسال منه؛ ' +
      'قبل ذلك لا تُرسل أي رسالة.',
    emailEmptyReadOnly:
      'لم يُربط أي صندوق بريد، فلا تُرسل أي رسالة. الربط من صلاحية مدير المكتب.',
    emailConnectHeading: 'ربط صندوق البريد',
    emailManageHeading: 'إدارة الصندوق المربوط',
    emailBeginButton: 'ابدأ الربط',
    emailStep1: '١. افتح صفحة المزوّد وامنح الموافقة بحساب صندوق المكتب.',
    emailOpenProvider: 'فتح صفحة موافقة المزوّد',
    emailStep2:
      '٢. بعد الموافقة سيعيدك المزوّد إلى عنوان يحتوي رمز التفويض. الصق العنوان كما هو.',
    emailRedirectLabel: 'العنوان الذي أُعدت إليه',
    emailMailboxLabel: 'عنوان صندوق البريد',
    emailTenantLabel: 'معرّف المستأجر (اختياري)',
    emailConnectButton: 'إتمام الربط',
    emailCancelButton: 'إلغاء الإدخال',
    emailRedirectNoCode:
      'لا يحتوي العنوان الملصق على رمز تفويض. الصق العنوان الكامل الذي أُعدت إليه.',
    emailRedirectStateMismatch:
      'لا يطابق العنوان الملصق طلب الربط الذي بدأته من هذه الشاشة، فلم يُكمل الربط. ' +
      'ابدأ الربط من جديد وأتمّه في الجلسة نفسها.',
    emailConnectedNotice: 'تم ربط صندوق البريد {address}. لم تُرسل أي رسالة بعد.',
    emailConnectFailed: 'تعذر إتمام الربط.',
    emailAuthorizeFailed: 'تعذر إنشاء رابط موافقة المزوّد.',
    emailNotConfiguredOnDeployment:
      'لا يمكن ربط صندوق بريد على هذا التركيب: لم يُهيَّأ للمزوّد المختار. ' +
      'هذا ليس إعداداً تملك تغييره من الشاشة — أبلغ من يدير التركيب.',
    emailVerifyButton: 'تحقق من الصلاحية',
    emailVerifyOk: 'الصندوق {address} يعمل ويمكنه الإرسال الآن. {detail}',
    emailVerifyNotOperational:
      'الصندوق مربوط ولا يمكنه الإرسال الآن. {detail} أعد الربط إن سُحبت الموافقة.',
    emailVerifyFailed: 'تعذر التحقق من الصندوق.',
    emailTestButton: 'إرسال رسالة اختبار',
    emailTestSent:
      'أُرسلت رسالة اختبار إلى صندوق مكتبك نفسه ({address}). افتح ذلك الصندوق لتراها. {detail}',
    emailTestNotConfigured: 'لم يُربط أي صندوق، فلا يوجد ما يُرسل منه.',
    emailTestCredentialRejected:
      'رفض المزوّد الصلاحية، فلم تُرسل الرسالة. {detail} أعد الربط لاستعادة الإرسال.',
    emailTestSendFailed: 'وصل الطلب إلى المزوّد ورفض الإرسال. {detail}',
    emailTestFailed: 'تعذر إرسال رسالة الاختبار.',
    emailRevokeButton: 'فصل الصندوق',
    emailRevokedNotice: 'فُصل الصندوق. لن يُرسل النظام أي رسالة حتى يُربط صندوق من جديد.',
    emailRevokeFailed: 'تعذر فصل الصندوق.',
  },
  EN: {
    emailHeading: 'Office mailbox',
    emailIntro:
      "The system sends from your office's own mailbox, never from a platform address. " +
      'Connect it once here, then verify or test it whenever you need to.',
    emailLoading: 'Loading…',
    emailRefusalAct: 'view the office email setup',
    emailLoadFailed: 'Could not read the office mailbox status — try again.',
    emailStatusHeading: 'Status',
    emailConnectedTo: 'Connected mailbox: {address}',
    emailProviderLabel: 'Provider',
    emailProviderMicrosoft: 'Microsoft 365',
    emailProviderGoogle: 'Google Workspace',
    emailLastSucceeded: 'Last successful send:',
    emailNeverSent: 'nothing sent yet',
    emailLastError: "The provider's last refusal: {detail}",
    emailEmptyWithAction:
      'No mailbox is connected, so the system sends nothing. Connect your office mailbox to ' +
      'let it send.',
    emailEmptyReadOnly:
      'No mailbox is connected, so the system sends nothing. Connecting one is the office ' +
      "administrator's to do.",
    emailConnectHeading: 'Connect a mailbox',
    emailManageHeading: 'Manage the connected mailbox',
    emailBeginButton: 'Start connecting',
    emailStep1:
      "1. Open the provider's page and grant consent while signed in as the office mailbox.",
    emailOpenProvider: "Open the provider's consent page",
    emailStep2:
      '2. After consenting, the provider sends you back to an address carrying an authorisation ' +
      'code. Paste that address here exactly as it is.',
    emailRedirectLabel: 'The address you were sent back to',
    emailMailboxLabel: 'Mailbox address',
    emailTenantLabel: 'Tenant ID (optional)',
    emailConnectButton: 'Finish connecting',
    emailCancelButton: 'Discard',
    emailRedirectNoCode:
      'The address you pasted carries no authorisation code. Paste the whole address the ' +
      'provider sent you back to.',
    emailRedirectStateMismatch:
      'The address you pasted does not match the connection this screen started, so nothing was ' +
      'connected. Start connecting again and finish it in the same sitting.',
    emailConnectedNotice: 'Mailbox {address} is connected. Nothing has been sent yet.',
    emailConnectFailed: 'Could not finish connecting the mailbox.',
    emailAuthorizeFailed: "Could not build the provider's consent link.",
    emailNotConfiguredOnDeployment:
      'A mailbox cannot be connected on this deployment: it has not been set up for the ' +
      'provider you chose. This is not something you can change from this screen — tell ' +
      'whoever runs the deployment.',
    emailVerifyButton: 'Verify the credential',
    emailVerifyOk: 'Mailbox {address} is working and can send right now. {detail}',
    emailVerifyNotOperational:
      'The mailbox is connected and cannot send right now. {detail} Connect it again if consent ' +
      'was withdrawn.',
    emailVerifyFailed: 'Could not verify the mailbox.',
    emailTestButton: 'Send a test message',
    emailTestSent:
      "A test message was sent to your office's own mailbox ({address}). Open that mailbox to " +
      'see it. {detail}',
    emailTestNotConfigured: 'No mailbox is connected, so there is nothing to send from.',
    emailTestCredentialRejected:
      'The provider rejected the credential, so nothing was sent. {detail} Connect the mailbox ' +
      'again to restore sending.',
    emailTestSendFailed: 'The request reached the provider and it refused to send. {detail}',
    emailTestFailed: 'Could not send the test message.',
    emailRevokeButton: 'Disconnect the mailbox',
    emailRevokedNotice:
      'The mailbox is disconnected. The system will send nothing until one is connected again.',
    emailRevokeFailed: 'Could not disconnect the mailbox.',
  },
} as const;
