#import "ArdiaHostInternal.h"
#import "ArdiaEarlyWindow.h"
#import "ArdiaServices.h"
#import "ArdiaNavigationDownloads.h"
#import "ArdiaStartup.h"
#import "ArdiaTabParking.h"
#import "ArdiaWebViewInternal.h"

#import <Security/Security.h>
#import <objc/runtime.h>

#include <cctype>
#include <cstring>
#include <set>
#include <string>
#include <vector>

using namespace ardia_host;

namespace ardia_host {

id<NSApplicationDelegate> (^gMakeDelegate)(void);

id<NSApplicationDelegate> gAppDelegate;


NSString *gDataDirectory;

}

namespace {

BOOL gMenuShortcutsReady;

void SendReservedShortcuts() {
  if (!ArdiaLaunchSequence.shared.engineRunning || !gMenuShortcutsReady) return;
  [ArdiaCoreEngine reservedShortcutsChanged];
}

}

namespace ardia_host {

void WatchReservedShortcuts() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    [NSNotificationCenter.defaultCenter addObserverForName:NSTextInputContextKeyboardSelectionDidChangeNotification object:nil queue:NSOperationQueue.mainQueue
                    usingBlock:^(NSNotification *) { SendReservedShortcuts(); }];
  });
  SendReservedShortcuts();
}

bool IsTeamSigned() {
  SecCodeRef code = nullptr;
  if (SecCodeCopySelf(kSecCSDefaultFlags, &code) != errSecSuccess) return false;
  CFDictionaryRef info = nullptr;
  OSStatus status = SecCodeCopySigningInformation((SecStaticCodeRef)code, kSecCSSigningInformation, &info);
  CFRelease(code);
  if (status != errSecSuccess || !info) return false;
  bool team = CFDictionaryGetValue(info, kSecCodeInfoTeamIdentifier) != nullptr;
  CFRelease(info);
  return team;
}

ArdiaBootstrapDelegate *gBootstrap;

bool gScratchDataDir = false;







NSMutableDictionary<NSString *, NSDictionary *> *gInstallPrompts = [NSMutableDictionary dictionary];

}

@implementation ArdiaHost

static void (^gQuitCancelledHandler)(void);

+ (void (^)(void))quitCancelledHandler {
  return gQuitCancelledHandler;
}

+ (void)setQuitCancelledHandler:(void (^)(void))handler {
  gQuitCancelledHandler = [handler copy];
}

+ (void)menuShortcutsChanged {
  gMenuShortcutsReady = YES;
  SendReservedShortcuts();
}

+ (void)replayInstallPrompts {
  for (NSDictionary *prompt in gInstallPrompts.allValues) [ArdiaEvents emit:@"extensions.installPrompt" data:prompt];
}

+ (void)resolveExtensionInstallPrompt:(NSString *)requestId accepted:(BOOL)accepted {
  [gInstallPrompts removeObjectForKey:requestId ?: @""];
  [ArdiaCoreEngine resolveExtensionInstallPrompt:requestId accepted:accepted];
}

+ (void)beginTracing:(void (^)(BOOL))completion {
  [ArdiaCoreEngine beginTracing:completion];
}

+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString *))completion {
  [ArdiaCoreEngine endTracing:keep completion:completion];
}

+ (BOOL)isTracing {
  return ArdiaCoreEngine.isTracing;
}

+ (void)deleteProfileData:(NSString *)profile completion:(void (^)(NSArray<NSString *> *))completion {
  if (ardia_host::IsPrivateProfile(profile)) return completion(@[]);
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  ArdiaCoreProfile *p = ardia_host::LoadedProfile(profile);
  if (!profile.length || !engine) return completion(@[ @"data" ]);
  [DeletedProfiles() addObject:profile];
  void (^remove)(ArdiaCoreProfile *) = ^(ArdiaCoreProfile *loaded) {
    if (!loaded) {
      NSString *path = [gDataDirectory stringByAppendingPathComponent:ardia_host::ProfileDirectoryName(profile)];
      [NSFileManager.defaultManager removeItemAtPath:path error:nil];
      return completion([NSFileManager.defaultManager fileExistsAtPath:path] ? @[ @"files" ] : @[]);
    }
    [engine deleteProfile:loaded completion:^(BOOL deleted) {
      if (deleted) [Profiles() removeObjectForKey:profile];
      else [DeletedProfiles() removeObject:profile];
      completion(deleted ? @[] : @[ @"data" ]);
    }];
  };
  if (!p && ProfileWaiters()[profile]) {
    DeletionsAfterLoad()[profile] = [remove copy];
    return;
  }
  remove(p);
}

+ (void)releaseProfile:(NSString *)profile {
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  ArdiaCoreProfile *p = ardia_host::LoadedProfile(profile);
  if (ardia_host::IsPrivateProfile(profile)) {
    if (profile) [ReleasedPrivateNames() addObject:profile];
    [Profiles() removeObjectForKey:profile];
    NSArray *waiting = ProfileWaiters()[profile];
    [ProfileWaiters() removeObjectForKey:profile];
    for (void (^waiter)(ArdiaCoreProfile *) in waiting) waiter(nil);
    ardia_host::ForgetPrivateNavigationDownloads(profile);
    if ([Profiles().allValues containsObject:p]) return;
  }
  if (p) [engine releaseProfile:p];
}

+ (NSArray<NSString *> *)loadedProfiles {
  return ardia_host::LoadedDataProfileNames();
}

+ (BOOL)stopCapture:(NSString *)tabId {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  return [tab stopCapture];
}

+ (BOOL)showAutofillSuggestions:(NSString *)tabId passwords:(BOOL)passwords {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  return [tab showAutofillSuggestions:passwords];
}

+ (void)deviceChooser:(int)chooserId select:(int)index {
  [ArdiaCoreEngine selectDevice:chooserId index:index];
}

+ (void)deviceChooser:(int)chooserId action:(NSString *)action {
  if ([action isEqualToString:@"cancel"])
    [ArdiaCoreEngine cancelDeviceChooser:chooserId];
  else if ([action isEqualToString:@"refresh"])
    [ArdiaCoreEngine refreshDeviceChooser:chooserId];
  else if ([action isEqualToString:@"settings"])
    [ArdiaCoreEngine openDeviceChooserSettings:chooserId];
}

+ (NSArray<NSDictionary *> *)testExternalLaunches {
  return ArdiaCoreEngine.testExternalLaunches ?: @[];
}

+ (BOOL)devShowBluetoothChooser:(NSString *)tabId unauthorized:(BOOL)unauthorized {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  return [tab devShowBluetoothChooser:unauthorized];
}

+ (NSArray<NSDictionary *> *)testChooserEvents {
  return ArdiaCoreEngine.testChooserEvents ?: @[];
}

+ (BOOL)shareTabInstead:(NSString *)capturerTabId target:(NSString *)targetTabId {
  ArdiaCoreTab *capturer = ardia_host::TabWithAppTabId(capturerTabId);
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(targetTabId);
  return capturer && [tab shareThisTabInsteadFor:capturer];
}

+ (BOOL)showCastDialog:(NSString *)tabId {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  return [tab showCastDialog];
}

+ (void)castDialog:(int)dialogId start:(NSString *)sink mode:(int)mode {
  [ArdiaCoreEngine startCasting:dialogId sink:sink mode:mode];
}

+ (void)castDialog:(int)dialogId stop:(NSString *)route {
  [ArdiaCoreEngine stopCasting:dialogId route:route];
}

+ (void)closeCastDialog:(int)dialogId {
  [ArdiaCoreEngine closeCastDialog:dialogId];
}

+ (void)watchCastRoutes:(NSString *)profileName {
  ardia_host::WithProfile(profileName, ^(ArdiaCoreProfile *profile) {
    [profile watchCastRoutes];
  });
}

+ (void)terminateCastRoute:(NSString *)route {
  [ArdiaCoreEngine terminateCastRoute:route];
}

+ (void)resolveExternalApp:(NSString *)requestId open:(BOOL)open remember:(BOOL)remember {
  [ArdiaCoreEngine resolveExternalApp:requestId open:open remember:remember];
}

+ (NSDictionary *)actionStates:(NSString *)tabId extensions:(NSArray<NSString *> *)ids {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  return [tab actionStatesForExtensions:ids] ?: @{};
}

+ (NSString *)sidePanelURL:(NSString *)tabId extension:(NSString *)extensionId {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  return [tab sidePanelURLForExtension:extensionId];
}

+ (BOOL)isPrivateProfile:(NSString *)profile {
  return ardia_host::IsPrivateProfile(profile);
}

+ (NSString *)baseProfileOf:(NSString *)profile {
  return ardia_host::OriginalProfileName(profile);
}

+ (int)chromeTabIdOfTab:(NSString *)tabId {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  return tab ? tab.tabId : -1;
}

+ (void)agentPage:(NSDictionary *)request completion:(void (^)(NSDictionary *))completion {
  NSString *operation = request[@"operation"];
  NSString *profile = request[@"profile"];
  NSString *tabId = request[@"tab"];
  NSString *expectedURL = request[@"url"];
  NSSet *operations = [NSSet setWithArray:@[@"snapshot", @"click", @"fill", @"press_key", @"scroll", @"screenshot", @"navigate", @"script"]];
  if (![operation isKindOfClass:NSString.class] || ![operations containsObject:operation] ||
      ![profile isKindOfClass:NSString.class] || ![tabId isKindOfClass:NSString.class] || ![expectedURL isKindOfClass:NSString.class]) {
    completion(@{@"error": @"Invalid agent operation"}); return;
  }
  NSMutableDictionary *authorization = [request mutableCopy];
  BOOL (^allowed)(void) = ^BOOL {
    authorization[@"allowed"] = @NO;
    [NSNotificationCenter.defaultCenter postNotificationName:@"ArdiaAgentAuthorize" object:authorization];
    return [authorization[@"allowed"] boolValue];
  };
  [ArdiaServices call:@"ac_cli_control" profile:@"" args:@{} completion:^(NSDictionary *status) {
    ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
    BOOL (^sameTarget)(void) = ^BOOL {
      NSURL *url = [NSURL URLWithString:tab.url ?: @""];
      return tab && !tab.closed && !tab.discarded && ardia_host::TabWithAppTabId(tabId) == tab &&
        tab.profile == ardia_host::Profiles()[profile] && !ardia_host::IsPrivateProfile(profile) &&
        (tab.profile != nil) && [@[@"http", @"https"] containsObject:url.scheme.lowercaseString] &&
        url.host.length && !url.user.length && !url.password.length && [tab.url isEqualToString:expectedURL];
    };
    if (![status[@"state"] isEqual:@"off"] || !allowed() || !sameTarget()) {
      completion(@{@"error": @"Agent access refused or target changed"}); return;
    }
    if ([operation isEqualToString:@"navigate"]) {
      NSString *destination = request[@"destination"];
      NSURL *url = [destination isKindOfClass:NSString.class] ? [NSURL URLWithString:destination] : nil;
      if (![@[@"http", @"https"] containsObject:url.scheme.lowercaseString] || !url.host.length || url.user.length || url.password.length) {
        completion(@{@"error": @"Only HTTP and HTTPS destinations are allowed"}); return;
      }
      [tab loadURL:destination userInitiated:NO];
      completion(@{@"ok": @YES}); return;
    }
    if ([operation isEqualToString:@"screenshot"]) {
      [tab devToolsCall:@"Page.captureScreenshot" params:@{@"format": @"png"} timeout:2.0 completion:^(NSDictionary *shot, NSString *error) {
        if (!allowed() || !sameTarget() || ![shot[@"data"] isKindOfClass:NSString.class]) { completion(@{@"error": @"Screenshot unavailable or access revoked"}); return; }
        if ([shot[@"data"] length] > 3 * 1024 * 1024) { completion(@{@"error": @"Screenshot too large; reduce the window size and retry"}); return; }
        completion(@{@"data": shot[@"data"], @"mimeType": @"image/png"});
      }];
      return;
    }
    NSMutableDictionary *payload = [request mutableCopy];
    payload[@"snapshotId"] = NSUUID.UUID.UUIDString;
    NSData *json = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    if (!json || json.length > 65536) { completion(@{@"error": @"Agent request too large"}); return; }
    NSString *source = [NSString stringWithUTF8String:R"JS((p=>{
      if(location.href!==p.url || !['http:','https:'].includes(location.protocol)) return {error:'Document changed'};
      const key='__ardiaAgent_'+p.connection;
      if(p.operation==='snapshot') {
        const nodes=Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[contenteditable="true"]')).filter(e=>e.getClientRects().length).slice(0,500);
        const id=p.snapshotId; globalThis[key]={id,nodes,document};
        return {snapshot:id,title:document.title,url:location.href,text:(document.body?.innerText||'').slice(0,40000),elements:nodes.map((e,i)=>({ref:String(i),tag:e.tagName.toLowerCase(),role:e.getAttribute('role'),name:(e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||'').slice(0,300),type:e.getAttribute('type')}))};
      }
      const saved=globalThis[key];
      if(!saved || saved.document!==document || saved.id!==p.snapshot) return {error:'Stale snapshot; take a new snapshot'};
      if(p.operation==='script') return {value:Function(p.script)()};
      const e=saved.nodes[Number(p.ref)];
      if(p.operation==='scroll') { window.scrollBy(0,p.delta); return {ok:true}; }
      if(!e || !e.isConnected || !e.getClientRects().length) return {error:'Element unavailable'};
      if(p.operation==='click') { const a=e.closest('a[href]'); if(a && !['http:','https:'].includes(new URL(a.href,location.href).protocol)) return {error:'Privileged link refused'}; e.click(); return {ok:true}; }
      if(p.operation==='fill') {
        if(!['INPUT','TEXTAREA'].includes(e.tagName) || e.type==='file' || e.disabled || e.readOnly) return {error:'Element cannot be filled'};
        const proto=e.tagName==='INPUT'?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;
        const setter=Object.getOwnPropertyDescriptor(proto,'value').set; setter.call(e,p.text);
        e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true};
      }
      if(p.operation==='press_key') {
        e.focus(); e.dispatchEvent(new KeyboardEvent('keydown',{key:p.key,bubbles:true}));
        if(p.key==='Enter' && e.form) e.form.requestSubmit();
        e.dispatchEvent(new KeyboardEvent('keyup',{key:p.key,bubbles:true}));return {ok:true};
      }
      return {error:'Unsupported operation'};
    }))JS"];
    NSString *expression = [NSString stringWithFormat:@"try { post('result', JSON.stringify(%@(%@))); } catch(e) { post('result', JSON.stringify({error:'Page operation failed'})); }", source, [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]];
    __block BOOL settled = NO;
    void (^finish)(NSDictionary *) = ^(NSDictionary *reply) {
      if (settled) return;
      settled = YES;
      completion(reply);
    };
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      finish(@{@"error": @"Page operation timed out; action may have completed"});
    });
    [tab evaluate:expression completion:^(NSString *result) {
      if (!allowed() || !sameTarget()) { finish(@{@"error": @"Target changed or access revoked; action may have completed"}); return; }
      id value = result ? [NSJSONSerialization JSONObjectWithData:[result dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] : nil;
      finish([value isKindOfClass:NSDictionary.class] ? value : @{@"error": @"No page result"});
    }];
  }];
}

+ (void)cliTabTargets:(NSArray<NSString *> *)tabIds completion:(void (^)(NSDictionary<NSString *, id> *targets))completion {
  static NSMutableDictionary<NSString *, NSString *> *lastTarget;
  static NSMutableDictionary<NSString *, NSNumber *> *generations;
  if (!lastTarget) {
    lastTarget = [NSMutableDictionary dictionary];
    generations = [NSMutableDictionary dictionary];
  }
  NSMutableDictionary<NSString *, id> *answer = [NSMutableDictionary dictionary];
  void (^record)(NSString *, NSString *) = ^(NSString *tabId, NSString *targetId) {
    if (targetId && ![lastTarget[tabId] isEqualToString:targetId]) {
      lastTarget[tabId] = targetId;
      generations[tabId] = @(generations[tabId].integerValue + 1);
    }
    answer[tabId] = @{@"targetId" : targetId ?: NSNull.null, @"pageGeneration" : generations[tabId] ?: @0};
  };
  dispatch_group_t pending = dispatch_group_create();
  for (NSString *tabId in tabIds) {
    ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
    if (!tab || tab.closed || tab.discarded) {
      record(tabId, nil);
      continue;
    }
    dispatch_group_enter(pending);
    [tab devToolsCall:@"Target.getTargetInfo"
               params:@{}
              timeout:1.0
           completion:^(NSDictionary *result, NSString *error) {
             id info = result[@"targetInfo"];
             id targetId = [info isKindOfClass:NSDictionary.class] ? info[@"targetId"] : nil;
             record(tabId, [targetId isKindOfClass:NSString.class] ? targetId : nil);
             dispatch_group_leave(pending);
           }];
  }
  dispatch_group_notify(pending, dispatch_get_main_queue(), ^{
    completion(answer);
  });
}

+ (void)resolvePermission:(NSString *)requestId result:(NSString *)result remember:(BOOL)remember {
  [ArdiaCoreEngine resolvePermission:requestId result:result remember:remember];
}

+ (NSArray<NSDictionary<NSString *, id> *> *)displayMediaSources {
  NSMutableArray *sources = [NSMutableArray array];
  NSUInteger index = 0;
  for (NSScreen *screen in NSScreen.screens) {
    NSNumber *display = screen.deviceDescription[@"NSScreenNumber"];
    index++;
    [sources addObject:@{
      @"id" : [NSString stringWithFormat:@"screen:%u:0", display.unsignedIntValue],
      @"kind" : @"screen",
      @"name" : screen.localizedName ?: [NSString stringWithFormat:@"Screen %lu", (unsigned long)index],
      @"width" : @(screen.frame.size.width),
      @"height" : @(screen.frame.size.height),
    }];
  }
  NSArray *windows = CFBridgingRelease(
      CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
  const pid_t me = getpid();
  for (NSDictionary *w in windows) {
    if ([w[(id)kCGWindowLayer] intValue] != 0 || [w[(id)kCGWindowOwnerPID] intValue] == me) continue;
    NSDictionary *bounds = w[(id)kCGWindowBounds];
    const CGFloat width = [bounds[@"Width"] doubleValue], height = [bounds[@"Height"] doubleValue];
    if (width < 50 || height < 50) continue;
    NSString *app = w[(id)kCGWindowOwnerName] ?: @"";
    NSString *title = w[(id)kCGWindowName];
    [sources addObject:@{
      @"id" : [NSString stringWithFormat:@"window:%u:0", [w[(id)kCGWindowNumber] unsignedIntValue]],
      @"kind" : @"window",
      @"name" : title.length ? title : app,
      @"app" : app,
      @"pid" : w[(id)kCGWindowOwnerPID] ?: @0,
      @"width" : @(width),
      @"height" : @(height),
    }];
  }
  return sources;
}

+ (BOOL)isStarted {
  return ArdiaLaunchSequence.shared.engineRunning;
}

+ (NSString *)dataDirectory {
  return gDataDirectory ?: @"";
}

+ (NSDictionary<NSString *, id> *)engineInfo {
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  NSInteger chromeWindows = 0;
  for (ArdiaWindowController *c in ArdiaWindowController.all) chromeWindows += c.coreWindow ? 1 : 0;
  return @{
    @"pid" : @(NSProcessInfo.processInfo.processIdentifier),
    @"dataDirectory" : gDataDirectory ?: @"",
    @"engine" : @"ardiacore",
    @"chromiumVersion" : engine.chromiumVersion ?: @"",
    @"liveBrowsers" : @0,
    @"popupWindows" : @(ardia_host::PopupWindowCount()),
    @"chromeWindows" : @(chromeWindows),
    @"keepAlive" : engine.keepAliveState ?: @"",
    @"lastUsedProfile" : engine.defaultProfile.name ?: @"",
    @"focus" : ardia_host::FocusState(),
  };
}

+ (NSArray<NSDictionary<NSString *, id> *> *)chromeWindows {
  NSMutableArray *list = [NSMutableArray array];
  for (ArdiaWindowController *c in ArdiaWindowController.all) {
    NSWindow *w = c.coreWindow.window;
    if (!w) continue;
    ArdiaCoreProfile *active = c.coreWindow.activeProfile;
    [list addObject:@{
      @"profile" : ardia_host::ProfileName(active),
      @"window" : @(w.windowNumber),
      @"frame" : NSStringFromRect(w.frame),
      @"alpha" : @(w.alphaValue),
      @"key" : @(w.isKeyWindow),
      @"canBecomeKey" : @(w.canBecomeKeyWindow),
      @"visible" : @(w.isVisible),
      @"occlusionVisible" : @((w.occlusionState & NSWindowOcclusionStateVisible) != 0),
      @"chromeOccluded" : [w respondsToSelector:NSSelectorFromString(@"isOccluded")] ? [w valueForKey:@"occluded"] : NSNull.null,
      @"parentWindow" : @(w.parentWindow.windowNumber),
      @"chromeWindows" : @1,
      @"anchorBrowserId" : @0,
      @"anyTabBrowserId" : @0,
      @"ready" : @YES,
      @"active" : @(w.isMainWindow),
      @"pageInsets" : @[ @0, @0, @0, @0 ],
      @"hosting" : @(c.root != nil),
      @"group" : @"",
      @"hasRoot" : @(c.root != nil),
      @"translucent" : @(!w.opaque),
    }];
  }
  return list;
}

@end
