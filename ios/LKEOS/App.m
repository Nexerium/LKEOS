#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import "Accounts.h"

typedef void (^Reply)(id value, NSString *error);
static NSString *const Home = @"campus://app/index.html";
static NSString *const Eos = @"https://e-learning.bmstu.ru/kaluga/";
static NSString *const Progress = @"https://lks.bmstu.ru/progress";
static NSString *const LksLogin = @"https://lks.bmstu.ru/portal4/cookie/login?back=https%3A%2F%2Flks.bmstu.ru%2Fprogress&profile_any=true";

static BOOL host(NSURL *u, NSString *h) {
    return [u.scheme isEqual:@"https"] && [u.host.lowercaseString isEqual:h] &&
        (!u.port || u.port.integerValue==443) && !u.user && !u.password;
}
static BOOL eosURL(NSURL *u) { return host(u,@"e-learning.bmstu.ru") && [u.path hasPrefix:@"/kaluga/"]; }
static NSString *script(NSString *name) {
    return [NSString stringWithContentsOfURL:[NSBundle.mainBundle URLForResource:name withExtension:@"js" subdirectory:@"PortalScripts"]
                                   encoding:NSUTF8StringEncoding error:nil];
}
static void run(WKWebView *web, NSString *body, NSDictionary *args, Reply reply) {
    if (!web || !body) { reply(nil,@"Откройте сеанс заново."); return; }
    [web callAsyncJavaScript:body arguments:args inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id value, NSError *error) {
        reply(value,error.localizedDescription);
    }];
}
@interface CampusController : UIViewController <WKURLSchemeHandler,WKNavigationDelegate,WKScriptMessageHandlerWithReply,WKScriptMessageHandler,WKUIDelegate,WKDownloadDelegate>
@property(nonatomic,strong) WKWebView *ui,*eos,*lks,*viewer,*front;
@property(nonatomic,strong) UIView *area;
@property(nonatomic,strong) UIStackView *bar;
@property(nonatomic,strong) UILabel *caption;
@property(nonatomic,strong) Accounts *accounts;
@property(nonatomic,copy) Reply pending;
@property(nonatomic,copy) NSString *mode;
@property(nonatomic,strong) NSTimer *timer;
@property(nonatomic) BOOL autoLogin, syncing, openedLksLogin, lksNeedsLogin;
@property(nonatomic,strong) NSNumber *editor;
@property(nonatomic) NSUInteger operations;
@property(nonatomic,strong) NSMapTable<WKDownload *,NSURL *> *downloads;
@end

@implementation CampusController
- (void)viewDidLoad {
    [super viewDidLoad];
    self.accounts=[Accounts new]; self.downloads=[NSMapTable strongToStrongObjectsMapTable];
    self.view.backgroundColor=UIColor.systemBackgroundColor;
    self.area=[UIView new]; self.area.translatesAutoresizingMaskIntoConstraints=NO;
    [self.view addSubview:self.area]; UILayoutGuide *g=self.view.safeAreaLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[[self.area.topAnchor constraintEqualToAnchor:g.topAnchor],
        [self.area.bottomAnchor constraintEqualToAnchor:g.bottomAnchor],[self.area.leadingAnchor constraintEqualToAnchor:g.leadingAnchor],
        [self.area.trailingAnchor constraintEqualToAnchor:g.trailingAnchor]]];
    WKWebViewConfiguration *config=[WKWebViewConfiguration new];
    [config setURLSchemeHandler:self forURLScheme:@"campus"];
    [config.userContentController addScriptMessageHandlerWithReply:self contentWorld:WKContentWorld.pageWorld name:@"campus"];
    self.ui=[[WKWebView alloc] initWithFrame:CGRectZero configuration:config];
    self.ui.navigationDelegate=self;
    self.ui.scrollView.contentInsetAdjustmentBehavior=UIScrollViewContentInsetAdjustmentNever;
    [self.area addSubview:self.ui];
    self.caption=[UILabel new]; self.caption.font=[UIFont preferredFontForTextStyle:UIFontTextStyleFootnote];
    self.caption.textAlignment=NSTextAlignmentRight; self.caption.adjustsFontSizeToFitWidth=YES;
    UIButton *back=[UIButton buttonWithType:UIButtonTypeSystem]; [back setTitle:@"‹  ЛКЭОС" forState:UIControlStateNormal];
    [back addTarget:self action:@selector(back) forControlEvents:UIControlEventTouchUpInside];
    self.bar=[[UIStackView alloc] initWithArrangedSubviews:@[back,self.caption]];
    self.bar.layoutMargins=UIEdgeInsetsMake(0,12,0,12);self.bar.layoutMarginsRelativeArrangement=YES;
    self.bar.backgroundColor=UIColor.secondarySystemBackgroundColor; self.bar.hidden=YES; [self.area addSubview:self.bar];
    [self.ui loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:Home]]];
}
- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews]; CGRect b=self.area.bounds; self.ui.frame=b;
    self.bar.frame=CGRectMake(0,0,b.size.width,44);
    for (WKWebView *web in self.area.subviews) if ([web isKindOfClass:WKWebView.class] && web!=self.ui)
        web.frame=CGRectMake(0,44,b.size.width,MAX(0,b.size.height-44));
}
- (void)webView:(WKWebView *)web startURLSchemeTask:(id<WKURLSchemeTask>)task {
    NSURL *url=task.request.URL; NSString *file=url.lastPathComponent;
    NSDictionary *mime=@{@"index.html":@"text/html",@"app.js":@"application/javascript",@"lab-ui.js":@"application/javascript",@"workboard.js":@"application/javascript",
        @"style.css":@"text/css",@"phone.css":@"text/css",@"hero.jpg":@"image/jpeg"};
    NSURL *local=mime[file] && [url.host isEqual:@"app"] && [url.path isEqual:[@"/" stringByAppendingString:file]] ?
        [NSBundle.mainBundle URLForResource:file withExtension:nil subdirectory:@"Web"] : nil;
    NSData *data=local ? [NSData dataWithContentsOfURL:local] : nil;
    if (!data) { [task didFailWithError:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorFileDoesNotExist userInfo:nil]];return; }
    [task didReceiveResponse:[[NSURLResponse alloc] initWithURL:url MIMEType:mime[file] expectedContentLength:data.length textEncodingName:@"utf-8"]];
    [task didReceiveData:data]; [task didFinish];
}
- (void)webView:(WKWebView *)web stopURLSchemeTask:(id<WKURLSchemeTask>)task {}
- (WKWebView *)portal:(NSString *)service viewer:(BOOL)viewer {
    BOOL lks=[service isEqual:@"lks"]; WKWebView *web=viewer ? self.viewer : (lks ? self.lks : self.eos);
    if (viewer && web) { [self discard:web]; self.viewer=nil; web=nil; }
    if (web) return web;
    WKWebViewConfiguration *config=[WKWebViewConfiguration new];
    config.websiteDataStore=[WKWebsiteDataStore dataStoreForIdentifier:[self.accounts storeID:service]];
    if (lks && !viewer) {
        [config.userContentController addScriptMessageHandler:self name:@"progress"];
        WKUserScript *watch=[[WKUserScript alloc] initWithSource:script(@"progress") injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES];
        [config.userContentController addUserScript:watch];
    }
    web=[[WKWebView alloc] initWithFrame:CGRectZero configuration:config]; web.navigationDelegate=self; web.UIDelegate=self;
    web.accessibilityIdentifier=service; web.hidden=YES; [self.area insertSubview:web belowSubview:self.bar];
    if (viewer) self.viewer=web; else if (lks) self.lks=web; else self.eos=web;
    [self.view setNeedsLayout]; return web;
}
- (void)discard:(WKWebView *)web {
    [web stopLoading]; web.navigationDelegate=nil; web.UIDelegate=nil;
    [web.configuration.userContentController removeAllScriptMessageHandlers]; [web removeFromSuperview];
}
- (void)clearService:(NSString *)service done:(void(^)(void))done {
    BOOL lks=[service isEqual:@"lks"]; WKWebView *web=lks ? self.lks : self.eos;
    [self discard:web]; if (lks) self.lks=nil; else {self.eos=nil; self.editor=nil;}
    if ([self.viewer.accessibilityIdentifier isEqual:service]) { [self discard:self.viewer]; self.viewer=nil; }
    [self.accounts setConnected:NO service:service];
    WKWebsiteDataStore *store=[WKWebsiteDataStore dataStoreForIdentifier:[self.accounts storeID:service]];
    [store removeDataOfTypes:WKWebsiteDataStore.allWebsiteDataTypes modifiedSince:NSDate.distantPast completionHandler:done];
}
- (void)show:(WKWebView *)web mode:(NSString *)mode reply:(Reply)reply {
    self.mode=mode; self.front=web; self.pending=reply; self.ui.hidden=YES; web.hidden=NO; self.bar.hidden=NO;
    self.caption.text=[web.accessibilityIdentifier isEqual:@"lks"] ? @"ЛКС МГТУ" : @"ЭОС МГТУ";
    self.autoLogin=YES; self.syncing=NO;
    if (reply) {
        __weak CampusController *weak=self;
        self.timer=[NSTimer scheduledTimerWithTimeInterval:600 repeats:NO block:^(NSTimer *t){ [weak finish:nil error:@"Время ожидания истекло. Повторите вход."]; }];
    }
}
- (void)finish:(id)value error:(NSString *)error {
    Reply cb=self.pending; self.pending=nil; [self.timer invalidate]; self.timer=nil;
    self.front.hidden=YES; self.front=nil; self.mode=nil; self.syncing=NO; self.autoLogin=NO;
    self.ui.hidden=NO; self.bar.hidden=YES;
    if (cb) cb(value ?: NSNull.null,error);
}
- (void)back {
    if ([self.mode isEqual:@"progress"] && self.lksNeedsLogin) {
        [self.front stopLoading]; [self finish:nil error:@"LKEOS_AUTH_LKS"]; return;
    }
    if ([self.mode isEqual:@"pick"]) {
        run(self.eos,script(@"files"),@{@"action":@"cancel",@"id":self.editor ?: @0},^(id v,NSString *e){});
        [self finish:@[] error:nil];return;
    }
    [self.front stopLoading]; [self finish:nil error:nil];
}
- (void)load:(NSString *)address web:(WKWebView *)web {
    [web loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:address]]];
}
- (void)study:(NSDictionary *)q reply:(Reply)reply {
    if (!eosURL(self.eos.URL)) {reply(nil,@"LKEOS_AUTH_EOS");return;}
    run(self.eos,script(@"session"),@{@"request":q},^(NSDictionary *result,NSString *error) {
        if (error || ![result isKindOfClass:NSDictionary.class] || !result[@"value"]) {
            if ([result isKindOfClass:NSDictionary.class] && [result[@"error"] isEqual:@"login"]) {reply(nil,@"LKEOS_AUTH_EOS");return;}
            NSString *message=[result isKindOfClass:NSDictionary.class] ? result[@"message"] : nil;
            reply(nil,message.length ? message : (error ?: @"Не удалось получить данные. Проверьте вход в ЭОС.")); return;
        }
        reply(result[@"value"],nil);
    });
}
- (void)webView:(WKWebView *)web decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decision {
    NSURL *u=action.request.URL;
    if (web==self.ui) {decision([u.absoluteString isEqual:Home] && action.targetFrame.isMainFrame ? WKNavigationActionPolicyAllow:WKNavigationActionPolicyCancel);return;}
    BOOL lks=[web.accessibilityIdentifier isEqual:@"lks"];
    BOOL allowed=host(u,@"sso.bmstu.ru") || (lks ? host(u,@"lks.bmstu.ru") : eosURL(u));
    if (!action.targetFrame) { decision(WKNavigationActionPolicyCancel); if (allowed) [web loadRequest:action.request]; return; }
    if (!action.targetFrame.isMainFrame) {decision(WKNavigationActionPolicyAllow);return;}
    if (!allowed && self.pending && web==self.front) [self finish:nil error:@"Переход за пределы официального сервиса остановлен."];
    decision(allowed ? ((web==self.viewer && action.shouldPerformDownload) ? WKNavigationActionPolicyDownload : WKNavigationActionPolicyAllow) : WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView *)web didFinishNavigation:(WKNavigation *)nav {
    if (web!=self.front) return;
    NSURL *u=web.URL; self.caption.text=u.host;
    if (web==self.lks && host(u,@"sso.bmstu.ru") && [self.mode isEqual:@"progress"]) self.lksNeedsLogin=YES;
    if (self.autoLogin && (host(u,@"sso.bmstu.ru") || (eosURL(u) && [u.path isEqual:@"/kaluga/login/index.php"]))) {
        NSDictionary *saved=[self.accounts credential:web.accessibilityIdentifier];
        if (saved) {
            NSMutableDictionary *args=[saved mutableCopy]; args[@"source"]=u.absoluteString; self.autoLogin=NO;
            run(web,script(@"login"),args,^(id clicked,NSString *e){
                if (![clicked boolValue] && web==self.front && [web.URL isEqual:u]) self.autoLogin=YES;
            });
        }
        return;
    }
    if (web==self.lks && [self.mode isEqual:@"progress"] && [u.path isEqual:@"/profile"] && host(u,@"lks.bmstu.ru")) {
        [self load:Progress web:web];return;
    }
    if (web!=self.eos || ![self.mode isEqual:@"signIn"] || !eosURL(u) || self.syncing) return;
    if ([u.path hasPrefix:@"/kaluga/auth/"] || [u.path hasPrefix:@"/kaluga/admin/"] || [u.path hasPrefix:@"/kaluga/login/"]) return;
    Reply ticket=self.pending; self.syncing=YES;
    [self study:@{@"action":@"dashboard"} reply:^(id value,NSString *error) {
        if (ticket!=self.pending) return;
        if (!error) [self.accounts setConnected:YES service:@"eos"];
        [self finish:value error:error];
    }];
}
- (void)webView:(WKWebView *)web didFailNavigation:(WKNavigation *)nav withError:(NSError *)error {
    if (web==self.front && self.pending && error.code!=NSURLErrorCancelled) [self finish:nil error:error.localizedDescription];
}
- (void)webView:(WKWebView *)web didFailProvisionalNavigation:(WKNavigation *)nav withError:(NSError *)error {
    [self webView:web didFailNavigation:nav withError:error];
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)web {
    if (web==self.ui) { [web reload];return; }
    if (self.front==web) [self finish:nil error:@"Страница была выгружена. Откройте раздел заново."];
}
- (void)userContentController:(WKUserContentController *)c didReceiveScriptMessage:(WKScriptMessage *)m {
    if (m.webView!=self.lks || !m.frameInfo.isMainFrame || !host(m.frameInfo.request.URL,@"lks.bmstu.ru") ||
        ![self.mode isEqual:@"progress"] || ![m.body isKindOfClass:NSDictionary.class]) return;
    NSDictionary *payload=m.body;
    if ([payload[@"type"] isEqual:@"expired"]) {
        self.lksNeedsLogin=YES;
        if (!self.openedLksLogin) {self.openedLksLogin=YES;[self load:LksLogin web:self.lks];}
        else if (!self.lks.loading && [self.lks.URL.path isEqual:@"/progress"]) [self finish:nil error:@"LKEOS_AUTH_LKS"];
        return;
    }
    if ([payload[@"type"] isEqual:@"result"] && [payload[@"disciplines"] isKindOfClass:NSArray.class]) {
        [self.accounts setConnected:YES service:@"lks"];[self finish:payload error:nil];
    } else [self finish:nil error:@"ЛКС не предоставил ведомость."];
}
- (void)editLogin:(NSString *)service reply:(Reply)reply {
    NSDictionary *old=[self.accounts credential:service];
    NSString *title=[service isEqual:@"lks"] ? @"Вход в ЛКС" : @"Вход в ЭОС";
    UIAlertController *alert=[UIAlertController alertControllerWithTitle:title message:@"Данные для этого профиля хранятся в Связке ключей iPhone." preferredStyle:UIAlertControllerStyleAlert];
    [alert addTextFieldWithConfigurationHandler:^(UITextField *f){f.placeholder=@"Имя пользователя"; f.text=old[@"login"]; f.textContentType=UITextContentTypeUsername; f.autocapitalizationType=UITextAutocapitalizationTypeNone; f.autocorrectionType=UITextAutocorrectionTypeNo;}];
    [alert addTextFieldWithConfigurationHandler:^(UITextField *f){f.placeholder=@"Пароль";f.secureTextEntry=YES;f.textContentType=UITextContentTypePassword;}];
    [alert addAction:[UIAlertAction actionWithTitle:@"Отмена" style:UIAlertActionStyleCancel handler:^(UIAlertAction *a){reply(self.accounts.view,nil);}]];
    [alert addAction:[UIAlertAction actionWithTitle:@"Сохранить" style:UIAlertActionStyleDefault handler:^(UIAlertAction *a){
        NSString *login=[alert.textFields[0].text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if (![self.accounts save:service login:login password:alert.textFields[1].text]) {reply(nil,@"Не удалось сохранить логин и пароль.");return;}
        if (![old[@"login"] isEqual:login]) [self clearService:service done:^{reply(self.accounts.view,nil);}];
        else reply(self.accounts.view,nil);
    }]];
    [self presentViewController:alert animated:YES completion:nil];
}
- (void)userContentController:(WKUserContentController *)c didReceiveScriptMessage:(WKScriptMessage *)m replyHandler:(void (^)(id,NSString *))reply {
    if (m.webView!=self.ui || !m.frameInfo.isMainFrame || ![m.frameInfo.request.URL.absoluteString isEqual:Home] ||
        ![m.body isKindOfClass:NSDictionary.class]) {reply(nil,@"Недоступно");return;}
    NSDictionary *q=m.body; NSString *a=q[@"action"], *service=q[@"service"];
    self.operations++; __block BOOL finished=NO;
    Reply done=^(id value,NSString *error){if (!finished) {finished=YES;self.operations--;reply(value ?: NSNull.null,error);}};
    if ([a isEqual:@"accounts"]) {done(self.accounts.view,nil);return;}
    if ([a isEqual:@"theme"]) { self.overrideUserInterfaceStyle=[q[@"mode"] isEqual:@"dark"] ? UIUserInterfaceStyleDark:UIUserInterfaceStyleLight; done(@YES,nil);return;}
    if ([a isEqual:@"academicCalendar"]) {
        NSURL *url=[NSURL URLWithString:@"https://lks.bmstu.ru/lks-back/api/v1/schedules/current"];
        [[NSURLSession.sharedSession dataTaskWithURL:url completionHandler:^(NSData *data,NSURLResponse *r,NSError *error){
            NSDictionary *p=data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
            dispatch_async(dispatch_get_main_queue(),^{done([p isKindOfClass:NSDictionary.class]?p[@"data"]:nil,error.localizedDescription);});
        }] resume]; return;
    }
    if (self.front) {done(nil,@"Сначала вернитесь в кабинет.");return;}
    if ([a isEqual:@"sessionStatus"]) {
        WKWebView *web=[service isEqual:@"eos"] ? self.eos : [service isEqual:@"lks"] ? self.lks : nil;
        if (!web) {done(@"unknown",nil);return;}
        run(web,script(@"session-status"),@{@"service":service},done);return;
    }
    if ([a isEqual:@"selectAccount"]) {
        if (self.operations>1) {done(nil,@"Дождитесь завершения загрузки.");return;}
        if (![self.accounts select:q[@"profileId"] newName:q[@"newName"]]) {done(nil,@"Укажите существующий профиль или новое уникальное имя.");return;}
        [self discard:self.eos];[self discard:self.lks];[self discard:self.viewer];self.eos=nil;self.lks=nil;self.viewer=nil;self.editor=nil;
        done(self.accounts.view,nil);return;
    }
    if ([a isEqual:@"editLogin"] || [a isEqual:@"forgetLogin"]) {
        if (![@[@"eos",@"lks"] containsObject:service]) {done(nil,@"Неизвестный сервис.");return;}
        if ([a isEqual:@"editLogin"]) [self editLogin:service reply:done];
        else if ([self.accounts forget:service]) done(self.accounts.view,nil); else done(nil,@"Не удалось удалить данные входа.");
        return;
    }
    if ([a isEqual:@"disconnect"] || [a isEqual:@"disconnectLks"]) {
        [self clearService:[a isEqual:@"disconnect"] ? @"eos":@"lks" done:^{done(@YES,nil);}];return;
    }
    if ([a isEqual:@"signIn"] || [a isEqual:@"progress"]) {
        BOOL lks=[a isEqual:@"progress"]; WKWebView *web=[self portal:lks ? @"lks":@"eos" viewer:NO];
        [self show:web mode:a reply:done]; self.openedLksLogin=lks && ![self.accounts connected:@"lks"]; self.lksNeedsLogin=NO;
        [self load:lks ? (self.openedLksLogin ? LksLogin:Progress) : [Eos stringByAppendingString:@"my/"] web:web];return;
    }
    if ([a isEqual:@"open"] || [a isEqual:@"progressPage"]) {
        NSURL *url=[NSURL URLWithString:[a isEqual:@"open"] ? q[@"url"]:Progress];
        BOOL lks=host(url,@"lks.bmstu.ru");
        if (!eosURL(url) && !(lks && ([@[@"/profile",@"/progress"] containsObject:url.path]))) {done(nil,@"Ссылка недоступна.");return;}
        WKWebView *web=[self portal:lks ? @"lks":@"eos" viewer:YES]; [self show:web mode:@"viewer" reply:nil];
        [web loadRequest:[NSURLRequest requestWithURL:url]];done(@YES,nil);return;
    }
    if ([a isEqual:@"refresh"]) {[self study:@{@"action":@"dashboard"} reply:done];return;}
    if ([@[@"course",@"submission",@"labDetails",@"workIndex",@"activityInfo"] containsObject:a]) {[self study:q reply:done];return;}
    NSNumber *lab=q[@"assignmentId"];
    if ([a isEqual:@"labEditor"]) {
        [self study:q reply:^(id data,NSString *error){
            if (error) {done(nil,error);return;}
            self.editor=lab;
            run(self.eos,script(@"files"),@{@"action":@"reset",@"id":lab},^(id ignored,NSString *e){done(data,e);});
        }];return;
    }
    if ([a isEqual:@"labDiscard"]) {
        if ([self.editor isEqual:lab]) {self.editor=nil;[self.eos evaluateJavaScript:@"delete window.lkeosUpload" completionHandler:nil];}
        done(@YES,nil);return;
    }
    if (![self.editor isEqual:lab] || !eosURL(self.eos.URL)) {done(nil,@"Откройте редактор ответа.");return;}
    if ([a isEqual:@"labChooseFiles"]) {
        [self show:self.eos mode:@"pick" reply:done]; self.caption.text=@"Файлы ответа";
        run(self.eos,script(@"files"),@{@"action":@"pick",@"id":lab},^(id value,NSString *error){
            if (self.pending==done) [self finish:value error:error];
        });return;
    }
    if ([a isEqual:@"labSave"]) {
        [self study:@{@"action":@"prepareLabUpload"} reply:^(id ignored,NSString *error){
            if (error) {done(nil,error);return;}
            run(self.eos,script(@"files"),@{@"action":@"attach",@"id":lab,@"keys":q[@"files"]},^(id value,NSString *e){
                if (e) {done(nil,e);return;}
                [self study:q reply:^(id result,NSString *failure){
                    if (!failure) { self.editor=nil;[self.eos evaluateJavaScript:@"delete window.lkeosUpload" completionHandler:nil]; }
                    done(result,failure);
                }];
            });
        }];return;
    }
    done(nil,@"Действие недоступно.");
}
- (void)webView:(WKWebView *)web decidePolicyForNavigationResponse:(WKNavigationResponse *)response decisionHandler:(void (^)(WKNavigationResponsePolicy))decision {
    decision(web==self.viewer && !response.canShowMIMEType ? WKNavigationResponsePolicyDownload:WKNavigationResponsePolicyAllow);
}
- (void)webView:(WKWebView *)web navigationAction:(WKNavigationAction *)action didBecomeDownload:(WKDownload *)download {download.delegate=self;}
- (void)webView:(WKWebView *)web navigationResponse:(WKNavigationResponse *)response didBecomeDownload:(WKDownload *)download {download.delegate=self;}
- (void)download:(WKDownload *)download decideDestinationUsingResponse:(NSURLResponse *)response suggestedFilename:(NSString *)filename completionHandler:(void (^)(NSURL *))completion {
    NSURL *dir=[[NSURL fileURLWithPath:NSTemporaryDirectory()] URLByAppendingPathComponent:NSUUID.UUID.UUIDString];
    BOOL ok=[NSFileManager.defaultManager createDirectoryAtURL:dir withIntermediateDirectories:YES attributes:nil error:nil];
    NSString *leaf=filename.lastPathComponent;
    if (!leaf.length || [leaf isEqual:@"."] || [leaf isEqual:@".."]) leaf=@"Документ";
    NSURL *dest=[dir URLByAppendingPathComponent:leaf]; if (ok) [self.downloads setObject:dest forKey:download];
    completion(ok ? dest:nil);
}
- (void)downloadDidFinish:(WKDownload *)download {
    NSURL *url=[self.downloads objectForKey:download];if (!url) return;
    [self.downloads removeObjectForKey:download];
    UIActivityViewController *share=[[UIActivityViewController alloc] initWithActivityItems:@[url] applicationActivities:nil];
    share.popoverPresentationController.sourceView=self.bar;
    share.completionWithItemsHandler=^(UIActivityType activity,BOOL completed,NSArray *items,NSError *error){[NSFileManager.defaultManager removeItemAtURL:url.URLByDeletingLastPathComponent error:nil];};
    [self presentViewController:share animated:YES completion:nil];
}
@end

@interface AppDelegate : UIResponder <UIApplicationDelegate>
@property(nonatomic,strong) UIWindow *window;
@end
@implementation AppDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    self.window=[[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];self.window.rootViewController=[CampusController new];
    [self.window makeKeyAndVisible];return YES;
}
@end
int main(int argc,char **argv) { @autoreleasepool { return UIApplicationMain(argc,argv,nil,NSStringFromClass(AppDelegate.class)); } }

