#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#include <bcrypt.h>
#include <array>
#include <bit>
#include <cstring>
#include <functional>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>
#include <fmt/chrono.h>
#include <LuaMadeSimple/LuaMadeSimple.hpp>
#include <Unreal/NameTypes.hpp>
#include <Unreal/FWeakObjectPtr.hpp>
#include <Unreal/FString.hpp>
#include <Unreal/UnrealInitializer.hpp>
#include <Unreal/CoreUObject/UObject/Class.hpp>
#include <Unreal/CoreUObject/UObject/UnrealType.hpp>
#include <Unreal/Hooks/Hooks.hpp>
#include <Unreal/Hooks/CallbackIterationData.hpp>
#include "reader_contract.hpp"
#include "root_lease.hpp"
#include "beat_guard.hpp"

namespace {
using RC::LuaMadeSimple::Lua;
constexpr char game_hash[]="c645757d1112491952b67bf29502b4721133ba6940a9cfb08358f0dde127560f";
constexpr char loader_hash[]="ce5e3c46a920cc00b2817ac61e438c9162830290379d0b5b9c4dfc2b29459290";
std::once_flag identity_once;
std::string identity_error;
std::wstring module_path(HMODULE module) {
    std::wstring path(32768,L'\0'); DWORD n=GetModuleFileNameW(module,path.data(),static_cast<DWORD>(path.size()));
    if (!n || n>=path.size()) throw std::runtime_error("Native module path is unavailable.");
    path.resize(n); return path;
}
std::string sha256(const std::wstring& path) {
    BCRYPT_ALG_HANDLE algorithm=nullptr; BCRYPT_HASH_HANDLE hash=nullptr; HANDLE file=INVALID_HANDLE_VALUE;
    auto cleanup=[&] { if (file!=INVALID_HANDLE_VALUE) CloseHandle(file); if(hash) BCryptDestroyHash(hash);if(algorithm) BCryptCloseAlgorithmProvider(algorithm,0); };
    try {
        if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)<0 || BCryptCreateHash(algorithm,&hash,nullptr,0,nullptr,0,0)<0)
            throw std::runtime_error("SHA-256 provider is unavailable.");
        file=CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_FLAG_SEQUENTIAL_SCAN,nullptr);
        if(file==INVALID_HANDLE_VALUE)throw std::runtime_error("Native module cannot be hashed.");
        std::array<UCHAR,65536> block{};DWORD count=0;
        for(;;){if(!ReadFile(file,block.data(),static_cast<DWORD>(block.size()),&count,nullptr))throw std::runtime_error("Native module hash read failed.");if(!count)break;if(BCryptHashData(hash,block.data(),count,0)<0)throw std::runtime_error("Native module hash update failed.");}
        std::array<UCHAR,32> digest{};if(BCryptFinishHash(hash,digest.data(),static_cast<ULONG>(digest.size()),0)<0)throw std::runtime_error("Native module hash finalization failed.");
        std::string result;constexpr char hex[]="0123456789abcdef";for(auto byte:digest){result+=hex[byte>>4];result+=hex[byte&15];}cleanup();return result;
    }catch(...){cleanup();throw;}
}
void identity() {
    std::call_once(identity_once,[] {try {
        auto loader=GetModuleHandleW(L"UE4SS.dll");if(!loader)throw std::runtime_error("Expected UE4SS loader is not loaded.");
        if(sha256(module_path(nullptr))!=game_hash || sha256(module_path(loader))!=loader_hash)
            throw std::runtime_error("Checked delegate reader requires the exact verified game and UE4SS loader.");
    }catch(const std::exception& e){identity_error=e.what();} });
    if(!identity_error.empty())throw std::runtime_error(identity_error);

}
void copy_readable(std::uintptr_t address,void* destination,std::size_t length) {
    auto end=fanservice::checked::add(address,length);auto cursor=address;
    while(cursor<end){MEMORY_BASIC_INFORMATION info{};if(VirtualQuery(reinterpret_cast<void*>(cursor),&info,sizeof(info))!=sizeof(info))throw std::runtime_error("Checked delegate range is unavailable.");
        const DWORD access=info.Protect&0xff;
        if(info.State!=MEM_COMMIT || info.Protect&(PAGE_GUARD|PAGE_NOACCESS) || !(access==PAGE_READONLY || access==PAGE_READWRITE || access==PAGE_WRITECOPY || access==PAGE_EXECUTE_READ || access==PAGE_EXECUTE_READWRITE || access==PAGE_EXECUTE_WRITECOPY))
            throw std::runtime_error("Checked delegate range is not readable.");
        auto region_end=fanservice::checked::add(reinterpret_cast<std::uintptr_t>(info.BaseAddress),info.RegionSize);if(region_end<=cursor)throw std::runtime_error("Checked delegate range did not advance.");cursor=(std::min)(end,region_end);
    }
    SIZE_T read=0;if(!ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<const void*>(address),destination,length,&read) || read!=length)throw std::runtime_error("Checked delegate snapshot read failed.");
}
RC::Unreal::UObject* guarded_weak_get(const RC::Unreal::FWeakObjectPtr* weak) {
    __try { return weak->Get(); } __except(EXCEPTION_EXECUTE_HANDLER) { return nullptr; }
}
void name_impl(const RC::Unreal::FName* name,std::wstring* output) { *output=name->ToString(); }
bool guarded_name(const RC::Unreal::FName* name,std::wstring* output) {
    __try { name_impl(name,output);return true; } __except(GetExceptionCode()==0xe06d7363 ? EXCEPTION_CONTINUE_SEARCH : EXCEPTION_EXECUTE_HANDLER) { return false; }
}
void game_thread_identity() {
    identity();if(!RC::Unreal::IsInGameThread())throw std::runtime_error("Checked delegate operations require the game thread.");
}
struct GuardScope {
    RC::Unreal::FWeakObjectPtr manager{},outer{},type{};
    std::uintptr_t address=0,outer_address=0,class_address=0;
    std::uint64_t generation=0,bypassed=0;
    fanservice::BeatLedger ledger;
};
std::mutex guards_mutex;
std::map<std::uintptr_t,GuardScope> guards;
std::uint64_t next_guard_generation=1;
RC::Unreal::UFunction* guarded_hit_function=nullptr;
RC::Unreal::Hook::GlobalCallbackId guard_callback=0;
bool guard_identity(const GuardScope& scope) {
    auto manager=guarded_weak_get(&scope.manager),outer=guarded_weak_get(&scope.outer),type=guarded_weak_get(&scope.type);
    return manager && outer && type && reinterpret_cast<std::uintptr_t>(manager)==scope.address
        && reinterpret_cast<std::uintptr_t>(outer)==scope.outer_address && reinterpret_cast<std::uintptr_t>(type)==scope.class_address
        && manager->GetClassPrivate()==type && manager->GetOuterPrivate()==outer && manager->IsRootSet();
}
void ensure_guard_hook() {
    using namespace RC::Unreal;
    if(guard_callback)return;
    auto function=UObjectGlobals::StaticFindObject<UFunction*>(nullptr,nullptr,L"/Script/CockHero.BeatSpawnerManager:OnBeatReachedCenter");
    auto event=UObjectGlobals::StaticFindObject<UScriptStruct*>(nullptr,nullptr,L"/Script/CockHero.BeatEvent");
    if(!function || !event || !function->HasAllFunctionFlags(RC::Unreal::FUNC_Native)
        || function->GetReturnProperty()!=nullptr || function->GetNumParms()!=1 || function->GetParmsSize()!=40 || event->GetPropertiesSize()!=40)
        throw std::runtime_error("Scratch beat guard reflected event size is incompatible.");
    auto parameter=function->FindProperty(FName(L"BeatEvent",FNAME_Find));
    if(!parameter || parameter->GetClass().GetName()!=L"StructProperty" || parameter->GetOffset_Internal()!=0
        || parameter->GetElementSize()!=40 || parameter->GetArrayDim()!=1 || !parameter->HasAllPropertyFlags(CPF_Parm)
        || parameter->HasAnyPropertyFlags(CPF_ReturnParm) || static_cast<FStructProperty*>(parameter)->GetStruct().Get()!=event)
        throw std::runtime_error("Scratch beat guard reflected event parameter is incompatible.");
    const std::array<const wchar_t*,6> names={L"AbsoluteFireTime",L"TargetHitTime",L"PatternIndex",L"Interval",L"BeatNumber",L"CustomMultiplier"};
    const std::array<const wchar_t*,6> kinds={L"DoubleProperty",L"DoubleProperty",L"IntProperty",L"DoubleProperty",L"IntProperty",L"FloatProperty"};
    const std::array<int,6> offsets={0,8,16,24,32,36},sizes={8,8,4,8,4,4};
    for(std::size_t i=0;i<names.size();++i) {
        auto property=event->FindProperty(FName(names[i],FNAME_Find));
        if(!property || property->GetClass().GetName()!=kinds[i] || property->GetOffset_Internal()!=offsets[i]
            || property->GetElementSize()!=sizes[i] || property->GetArrayDim()!=1)
            throw std::runtime_error("Scratch beat guard reflected event fields are incompatible.");
    }
    guarded_hit_function=function;
    Hook::FCallbackOptions options;options.OwnerModName=L"FanserviceScratchRoot";options.HookName=L"OwnedBeatDeduplication";
    guard_callback=Hook::RegisterProcessEventPreCallback([](Hook::TCallbackIterationData<void>& data,UObject* context,UFunction* target,void* parameters) {
        if(target!=guarded_hit_function || !context || !IsInGameThread())return;
        std::lock_guard lock(guards_mutex);
        auto slot=guards.find(reinterpret_cast<std::uintptr_t>(context));
        if(slot==guards.end() || !guard_identity(slot->second))return;
        auto& scope=slot->second;
        if(data.OriginalFunctionCallPrevented()){++scope.bypassed;return;}
        try {
            std::uint8_t running=0;copy_readable(scope.address+264,&running,1);
            if(!(running&1)){++scope.bypassed;return;}
            fanservice::GuardBeat event{};copy_readable(reinterpret_cast<std::uintptr_t>(parameters),&event,sizeof(event));
            if(scope.ledger.observe(event)!=fanservice::BeatDecision::accepted)data.PreventOriginalFunctionCall();
        }catch(...) {
            ++scope.ledger.malformed;++scope.ledger.suppressed;data.PreventOriginalFunctionCall();
        }
    },options);
    if(!guard_callback)throw std::runtime_error("Scratch beat guard hook registration failed.");
}
RC::Unreal::UObject* spawn_fixed_fresh(RC::Unreal::UClass* type,RC::Unreal::UObject* outer,std::string_view inventory) {
    using namespace RC::Unreal;
    auto statics_type=UObjectGlobals::StaticFindObject<UClass*>(nullptr,nullptr,L"/Script/Engine.GameplayStatics");
    auto statics=UObjectGlobals::StaticFindObject<UObject*>(nullptr,nullptr,L"/Script/Engine.Default__GameplayStatics");
    auto spawn=UObjectGlobals::StaticFindObject<UFunction*>(nullptr,nullptr,L"/Script/Engine.GameplayStatics:SpawnObject");
    if(!statics_type || !statics || !spawn || statics->GetClassPrivate()!=statics_type
        || spawn->GetOuterPrivate()!=statics_type || !spawn->HasAllFunctionFlags(FUNC_Static|FUNC_Native)
        || spawn->GetNumParms()!=3 || spawn->GetParmsSize()!=24 || spawn->GetReturnValueOffset()!=16)
        throw std::runtime_error("Scratch factory SpawnObject reflection signature is incompatible.");
    const std::array<const wchar_t*,3> names={L"ObjectClass",L"Outer",L"ReturnValue"};
    const std::array<const wchar_t*,3> kinds={L"ClassProperty",L"ObjectProperty",L"ObjectProperty"};
    for(std::size_t index=0;index<names.size();++index) {
        auto property=spawn->FindProperty(FName(names[index],FNAME_Find));
        if(!property || property->GetClass().GetName()!=kinds[index]
        || property->GetOffset_Internal()!=static_cast<int>(index*sizeof(void*))
        || property->GetElementSize()!=sizeof(void*) || property->GetArrayDim()!=1
        || !property->HasAllPropertyFlags(CPF_Parm)
        || (index<2 && property->HasAnyPropertyFlags(CPF_OutParm|CPF_ReturnParm))
        || (index==2 && !property->HasAllPropertyFlags(CPF_OutParm|CPF_ReturnParm)))
        throw std::runtime_error("Scratch factory SpawnObject pointer parameter layout is incompatible.");
    }
    std::vector<UObject*> previous;
    UObjectGlobals::FindAllOf(inventory,previous,false);
    if(previous.size()>4096)throw std::runtime_error("Scratch factory manager inventory exceeds its bound.");
    struct SpawnParameters {UClass* object_class;UObject* outer;UObject* result;};
    static_assert(sizeof(SpawnParameters)==24 && offsetof(SpawnParameters,outer)==8 && offsetof(SpawnParameters,result)==16);
    SpawnParameters parameters{};parameters.object_class=type;parameters.outer=outer;
    statics->ProcessEvent(spawn,&parameters);
    auto manager=parameters.result;
    for(auto existing:previous)if(manager==existing)throw std::runtime_error("Scratch factory SpawnObject returned a pre-existing manager.");
    if(!manager || manager==outer || manager->GetClassPrivate()!=type || manager->GetOuterPrivate()!=outer
        || !UObjectGlobals::IsValidObjectForFindXOf(manager))throw std::runtime_error("Scratch factory returned an invalid exact manager.");
    if(!manager->HasAnyFlags(RF_Transient))manager->SetFlags(RF_Transient);
    return manager;
}
struct NativeScratch {
    struct Record {
        RC::Unreal::FWeakObjectPtr manager{},outer{},type{};
        std::uintptr_t manager_address=0,outer_address=0,class_address=0;
        bool factory_created=false;
        std::uint64_t generation=0;
    };
    Record create(std::uintptr_t requested_outer) {
        using namespace RC::Unreal;
        std::vector<UObject*> instances;
        UObjectGlobals::FindAllOf(std::string_view("BP_CHGameInstance_C"),instances,false);
        if(instances.size()>64)throw std::runtime_error("Scratch factory GameInstance inventory exceeds its bound.");
        UObject* outer=nullptr;
        for(auto candidate:instances)if(reinterpret_cast<std::uintptr_t>(candidate)==requested_outer) {
            if(outer)throw std::runtime_error("Scratch factory GameInstance identity is ambiguous.");outer=candidate;
        }
        auto game_instance_type=UObjectGlobals::StaticFindObject<UClass*>(nullptr,nullptr,L"/Script/Engine.GameInstance");
        auto type=UObjectGlobals::StaticFindObject<UClass*>(nullptr,nullptr,L"/Script/CockHero.BeatSpawnerManager");
        if(!outer || !game_instance_type || !type || !UObjectGlobals::IsValidObjectForFindXOf(outer)
            || !outer->IsA(game_instance_type) || outer->GetClassPrivate()->GetName()!=L"BP_CHGameInstance_C")
            throw std::runtime_error("Scratch factory requires the live exact BP_CHGameInstance_C outer.");
        auto manager=spawn_fixed_fresh(type,outer,"BeatSpawnerManager");
        Record record;record.manager=manager;record.outer=outer;record.type=type;
        record.manager_address=reinterpret_cast<std::uintptr_t>(manager);record.outer_address=requested_outer;
        record.class_address=reinterpret_cast<std::uintptr_t>(type);record.factory_created=true;
        if(next_guard_generation==UINT64_MAX)throw std::runtime_error("Scratch beat guard generation limit reached.");
        record.generation=next_guard_generation++;return record;
    }
    bool fresh(const Record& record) {return record.factory_created;}
    bool valid(const Record& record) {
        auto manager=guarded_weak_get(&record.manager);auto outer=guarded_weak_get(&record.outer);auto type=guarded_weak_get(&record.type);
        return record.factory_created && manager && outer && type
            && reinterpret_cast<std::uintptr_t>(manager)==record.manager_address
            && reinterpret_cast<std::uintptr_t>(outer)==record.outer_address
            && reinterpret_cast<std::uintptr_t>(type)==record.class_address
            && manager->GetClassPrivate()==type && manager->GetOuterPrivate()==outer
            && RC::Unreal::UObjectGlobals::IsValidObjectForFindXOf(manager)
            && RC::Unreal::UObjectGlobals::IsValidObjectForFindXOf(outer);
    }
    bool rooted(const Record& record) {auto manager=guarded_weak_get(&record.manager);if(!manager)throw std::runtime_error("Scratch root manager expired.");return manager->IsRootSet();}
    void require_idle(const Record& record) {
        std::uint8_t running=0;fanservice::checked::Header queue{};
        copy_readable(fanservice::checked::add(record.manager_address,264),&running,1);
        copy_readable(fanservice::checked::add(record.manager_address,232),&queue,sizeof(queue));
        if((running&1)!=0 || queue.count!=0 || queue.capacity<0 || queue.capacity>1000000
            || (queue.capacity && (!queue.data || queue.data%8)))
            throw std::runtime_error("Scratch root release/acquisition requires a stopped manager with an empty owned queue.");
    }
    void set_root(const Record& record) {
        if(!valid(record) || rooted(record))throw std::runtime_error("Scratch root acquisition identity/root flag changed.");
        ensure_guard_hook();
        guarded_weak_get(&record.manager)->SetRootSet();
        std::lock_guard lock(guards_mutex);
        GuardScope scope;scope.manager=record.manager;scope.outer=record.outer;scope.type=record.type;
        scope.address=record.manager_address;scope.outer_address=record.outer_address;scope.class_address=record.class_address;scope.generation=record.generation;
        if(!guards.emplace(record.manager_address,std::move(scope)).second)throw std::runtime_error("Scratch beat guard identity was already tracked.");
    }
    void clear_root(const Record& record) {
        if(!valid(record) || !rooted(record))throw std::runtime_error("Scratch root release identity/root flag changed.");
        require_idle(record);
        std::lock_guard lock(guards_mutex);
        auto slot=guards.find(record.manager_address);
        if(slot!=guards.end() && slot->second.generation!=record.generation)throw std::runtime_error("Scratch beat guard generation changed.");
        guarded_weak_get(&record.manager)->ClearRootSet();
        if(slot!=guards.end())guards.erase(slot);
    }
    std::uintptr_t address(const Record& record) {return record.manager_address;}
};
fanservice::ScratchRoots<NativeScratch> scratch_roots;
RC::Unreal::UFunction* audio_query(const wchar_t* path,const wchar_t* kind,int size) {
    using namespace RC::Unreal;
    auto type=UObjectGlobals::StaticFindObject<UClass*>(nullptr,nullptr,L"/Script/MediaAssets.MediaPlayer");
    auto function=UObjectGlobals::StaticFindObject<UFunction*>(nullptr,nullptr,path);
    if(!type || !function || function->GetOuterPrivate()!=type || !function->HasAllFunctionFlags(FUNC_Native)
        || function->HasAnyFunctionFlags(FUNC_Static) || function->GetNumParms()!=1
        || function->GetParmsSize()!=size || function->GetReturnValueOffset()!=0)
        throw std::runtime_error("Audio root closed-state query signature is incompatible.");
    auto property=function->FindProperty(FName(L"ReturnValue",FNAME_Find));
    if(!property || property->GetClass().GetName()!=kind || property->GetOffset_Internal()!=0
        || property->GetElementSize()!=size || property->GetArrayDim()!=1
        || !property->HasAllPropertyFlags(CPF_Parm|CPF_OutParm|CPF_ReturnParm))
        throw std::runtime_error("Audio root closed-state return layout is incompatible.");
    if(size==1) {
        auto boolean=static_cast<FBoolProperty*>(property);
        if(!boolean->IsNativeBool() || boolean->GetByteOffset()!=0 || boolean->GetByteMask()!=1)
            throw std::runtime_error("Audio root closed-state bool storage is incompatible.");
    }
    return function;
}
struct NativeAudio : NativeScratch {
    Record create(std::uintptr_t requested_outer) {
        using namespace RC::Unreal;
        std::vector<UObject*> actors,controllers;
        UObjectGlobals::FindAllOf(std::string_view("BP_GlobalManager_C"),actors,false);
        UObjectGlobals::FindAllOf(std::string_view("PlayerController"),controllers,false);
        if(actors.size()>128 || controllers.size()>128)throw std::runtime_error("Audio root actor inventory exceeds its bound.");
        UObject* outer=nullptr;
        auto actor_type=UObjectGlobals::StaticFindObject<UClass*>(nullptr,nullptr,L"/Script/Engine.Actor");
        auto controller_type=UObjectGlobals::StaticFindObject<UClass*>(nullptr,nullptr,L"/Script/Engine.PlayerController");
        for(auto actor:actors)if(reinterpret_cast<std::uintptr_t>(actor)==requested_outer
            && actor->GetClassPrivate()->GetName()==L"BP_GlobalManager_C")outer=actor;
        for(auto actor:controllers)if(reinterpret_cast<std::uintptr_t>(actor)==requested_outer
            && controller_type && actor->IsA(controller_type))outer=actor;
        if(!outer || !actor_type || !outer->IsA(actor_type) || !UObjectGlobals::IsValidObjectForFindXOf(outer))
            throw std::runtime_error("Audio root requires a live exact global manager or player controller actor.");
        auto type=UObjectGlobals::StaticFindObject<UClass*>(nullptr,nullptr,L"/Script/MediaAssets.MediaPlayer");
        if(!type)throw std::runtime_error("Audio root fixed MediaPlayer class is unavailable.");
        auto player=spawn_fixed_fresh(type,outer,"MediaPlayer");
        Record record;record.manager=player;record.outer=outer;record.type=type;record.factory_created=true;
        record.manager_address=reinterpret_cast<std::uintptr_t>(player);record.outer_address=requested_outer;
        record.class_address=reinterpret_cast<std::uintptr_t>(type);return record;
    }
    void require_idle(const Record& record) {
        using namespace RC::Unreal;
        if(!valid(record))throw std::runtime_error("Audio root closed-state identity changed.");
        auto player=guarded_weak_get(&record.manager);
        static_assert(sizeof(FString)==16);
        auto url_function=audio_query(L"/Script/MediaAssets.MediaPlayer:GetUrl",L"StrProperty",16);
        FString url;player->ProcessEvent(url_function,&url);
        if(url.Len()!=0)throw std::runtime_error("Audio root release/acquisition requires an empty media URL.");
        for(auto path:{L"/Script/MediaAssets.MediaPlayer:IsReady",L"/Script/MediaAssets.MediaPlayer:IsPreparing"}) {
            auto function=audio_query(path,L"BoolProperty",1);std::uint8_t result=0;
            player->ProcessEvent(function,&result);
            if(result!=0)throw std::runtime_error("Audio root release/acquisition requires a closed, unprepared player.");
        }
    }
    void set_root(const Record& record) {
        if(!valid(record) || rooted(record))throw std::runtime_error("Audio root acquisition identity/root flag changed.");
        guarded_weak_get(&record.manager)->SetRootSet();
    }
    void clear_root(const Record& record) {
        if(!valid(record) || !rooted(record))throw std::runtime_error("Audio root release identity/root flag changed.");
        require_idle(record);guarded_weak_get(&record.manager)->ClearRootSet();
    }
};
fanservice::ScratchRoots<NativeAudio> audio_roots(NativeAudio{},INT64_C(4294967296));
int create_audio(const Lua& lua) {
    game_thread_identity();if(lua.get_stack_size()!=1 || !lua.is_integer(1))throw std::runtime_error("Expected one audio owner actor address integer.");
    auto outer=lua.get_integer(1);if(outer<=0)throw std::runtime_error("Audio owner address must be positive.");
    auto [token,address]=audio_roots.create(static_cast<std::uintptr_t>(outer));
    lua.set_integer(token);lua.set_integer(static_cast<std::int64_t>(address));return 2;
}
int release_audio(const Lua& lua) {
    game_thread_identity();if(lua.get_stack_size()!=1 || !lua.is_integer(1))throw std::runtime_error("Expected one audio root token integer.");
    auto token=lua.get_integer(1);if(token<INT64_C(4294967296))throw std::runtime_error("Audio root token belongs to another lease family.");
    lua.set_bool(audio_roots.release(token));return 1;
}
int create_scratch(const Lua& lua) {
    game_thread_identity();if(lua.get_stack_size()!=1 || !lua.is_integer(1))throw std::runtime_error("Expected one GameInstance address integer.");
    auto outer=lua.get_integer(1);if(outer<=0)throw std::runtime_error("Scratch GameInstance address must be positive.");
    auto [token,address]=scratch_roots.create(static_cast<std::uintptr_t>(outer));lua.set_integer(token);lua.set_integer(static_cast<std::int64_t>(address));return 2;
}
int release_scratch(const Lua& lua) {
    game_thread_identity();if(lua.get_stack_size()!=1 || !lua.is_integer(1))throw std::runtime_error("Expected one scratch root token integer.");
    auto token=lua.get_integer(1);if(token<=0)throw std::runtime_error("Scratch root token must be positive.");
    lua.set_bool(scratch_roots.release(token));return 1;
}
int guard_status(const Lua& lua) {
    game_thread_identity();if(lua.get_stack_size()!=1 || !lua.is_integer(1))throw std::runtime_error("Expected one scratch root token integer.");
    auto token=lua.get_integer(1);if(token<=0)throw std::runtime_error("Scratch root token must be positive.");
    return scratch_roots.inspect(token,[&](const NativeScratch::Record& record) {
        std::lock_guard lock(guards_mutex);auto slot=guards.find(record.manager_address);
        if(slot==guards.end() || slot->second.generation!=record.generation || !guard_identity(slot->second))
            throw std::runtime_error("Scratch beat guard is not active for this lease.");
        const auto& scope=slot->second;
        for(auto value:{scope.ledger.accepted,scope.ledger.suppressed,scope.ledger.malformed,scope.ledger.changed,scope.generation,scope.bypassed,scope.ledger.deferred})
            lua.set_integer(static_cast<std::int64_t>(value));
        return 7;
    });
}
int set_scratch_clock(const Lua& lua) {
    game_thread_identity();
    if(lua.get_stack_size()!=3 || !lua.is_integer(1) || !lua.is_number(2) || !lua.is_bool(3))
        throw std::runtime_error("Expected scratch token integer, decoder position number and playing boolean.");
    const auto playing=lua.get_bool(3);
    const auto position=lua.get_number(2);
    const auto token=lua.get_integer(1);
    if(token<=0)throw std::runtime_error("Scratch root token must be positive.");
    scratch_roots.inspect(token,[&](const NativeScratch::Record& record) {
        std::lock_guard lock(guards_mutex);auto slot=guards.find(record.manager_address);
        if(slot==guards.end() || slot->second.generation!=record.generation || !guard_identity(slot->second))
            throw std::runtime_error("Scratch decoder clock requires this lease's live owned guard.");
        slot->second.ledger.set_clock(position,playing);
        return true;
    });
    lua.set_bool(true);return 1;
}
std::string utf8(const std::wstring& text) {
    if(text.size()>1024)throw std::runtime_error("Checked delegate callback name is too long.");
    if(text.empty())return {};
    int n=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,text.data(),static_cast<int>(text.size()),nullptr,0,nullptr,nullptr);
    if(!n)throw std::runtime_error("Checked delegate callback name is invalid.");std::string result(n,'\0');
    if(WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,text.data(),static_cast<int>(text.size()),result.data(),n,nullptr,nullptr)!=n)throw std::runtime_error("Checked delegate callback conversion failed.");return result;
}
int read_bindings(const Lua& lua) {
    game_thread_identity();
    if(lua.get_stack_size()!=3 || !lua.is_integer(1) || !lua.is_integer(2) || !lua.is_integer(3))throw std::runtime_error("Expected object address, fixed delegate kind and entry index integers.");
    auto [input,kind,index]=fanservice::checked::read_arguments([&](int position){return lua.get_integer(position);});
    if(input<=0 || index<0)throw std::runtime_error("Checked delegate address/index is invalid.");
    auto address=fanservice::checked::header_address(static_cast<std::uintptr_t>(input),kind);
    fanservice::checked::Header before{},after{};copy_readable(address,&before,sizeof(before));fanservice::checked::validate(before);
    std::uintptr_t object=0;std::string function;
    if(index){fanservice::checked::Entry entry{};copy_readable(fanservice::checked::entry_address(before,index),&entry,sizeof(entry));
        static_assert(sizeof(RC::Unreal::FWeakObjectPtr)==8 && sizeof(RC::Unreal::FName)==8);
        RC::Unreal::FWeakObjectPtr weak{};std::memcpy(&weak,entry.object.data(),8);
        auto resolved=guarded_weak_get(&weak);object=reinterpret_cast<std::uintptr_t>(resolved);
        if(resolved){RC::Unreal::FName name{};std::memcpy(&name,entry.name.data(),8);std::wstring value;if(!guarded_name(&name,&value))throw std::runtime_error("Checked delegate callback name could not be resolved.");function=utf8(value);}
        fanservice::checked::Entry repeated{};copy_readable(fanservice::checked::entry_address(before,index),&repeated,sizeof(repeated));
        if(std::memcmp(entry.object.data(),repeated.object.data(),entry.object.size()) || std::memcmp(entry.name.data(),repeated.name.data(),entry.name.size()))
            throw std::runtime_error("Checked delegate binding changed during inspection.");
    }
    copy_readable(address,&after,sizeof(after));if(!fanservice::checked::same(before,after))throw std::runtime_error("Checked delegate invocation list changed during inspection.");
    lua.set_integer(before.count);lua.set_integer(static_cast<std::int64_t>(object));lua.set_string(function);return 3;
}
}
extern "C" __declspec(dllexport) int luaopen_fanservice_delegate_reader(lua_State* state) {
    try {
        identity();if(!state) return 0;
        HMODULE pinned=nullptr;
        if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&luaopen_fanservice_delegate_reader),&pinned))return 0;
        Lua lua(state);lua.register_function("FanserviceReadCheckedBindings",read_bindings);
        lua.register_function("FanserviceCreateScratchRoot",create_scratch);
        lua.register_function("FanserviceCreateAudioRoot",create_audio);
        lua.register_function("FanserviceReleaseAudioRoot",release_audio);
        lua.register_function("FanserviceScratchGuardStatus",guard_status);
        lua.register_function("FanserviceSetScratchClock",set_scratch_clock);
        lua.register_function("FanserviceReleaseScratchRoot",release_scratch);return 0;
    }catch(const std::exception& e){if(state){Lua lua(state);lua.set_string(e.what(),std::strlen(e.what()));return 1;}return 0;}catch(...){return 0;}
}
