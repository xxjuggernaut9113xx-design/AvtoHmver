#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#include <bcrypt.h>
#include <array>
#include <cstring>
#include <mutex>
#include <string>
#include <LuaMadeSimple/LuaMadeSimple.hpp>
#include "readiness.hpp"

namespace {
using RC::LuaMadeSimple::Lua;
constexpr char game_hash[]="a8f46896593d8724cefb9a232db5772df48ae5731da78cfacbec82e98d040c10";
constexpr char loader_hash[]="ce5e3c46a920cc00b2817ac61e438c9162830290379d0b5b9c4dfc2b29459290";
std::wstring module_path(HMODULE module) {
    std::wstring path(32768,L'\0');
    const auto count=GetModuleFileNameW(module,path.data(),static_cast<DWORD>(path.size()));
    if(!count || count>=path.size())throw std::runtime_error("CEF module path is unavailable.");
    path.resize(count);return path;
}
std::string sha256(const std::wstring& path) {
    BCRYPT_ALG_HANDLE algorithm=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;HANDLE file=INVALID_HANDLE_VALUE;
    auto cleanup=[&]{if(file!=INVALID_HANDLE_VALUE)CloseHandle(file);if(hash)BCryptDestroyHash(hash);if(algorithm)BCryptCloseAlgorithmProvider(algorithm,0);};
    try {
        if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)<0
            || BCryptCreateHash(algorithm,&hash,nullptr,0,nullptr,0,0)<0)throw std::runtime_error("CEF identity hash is unavailable.");
        file=CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_FLAG_SEQUENTIAL_SCAN,nullptr);
        if(file==INVALID_HANDLE_VALUE)throw std::runtime_error("CEF identity file cannot be read.");
        std::array<UCHAR,65536> block{};DWORD count=0;
        for(;;){if(!ReadFile(file,block.data(),static_cast<DWORD>(block.size()),&count,nullptr))throw std::runtime_error("CEF identity read failed.");if(!count)break;if(BCryptHashData(hash,block.data(),count,0)<0)throw std::runtime_error("CEF identity hash failed.");}
        std::array<UCHAR,32> bytes{};if(BCryptFinishHash(hash,bytes.data(),static_cast<ULONG>(bytes.size()),0)<0)throw std::runtime_error("CEF identity digest failed.");
        std::string result;constexpr char hex[]="0123456789abcdef";for(auto byte:bytes){result+=hex[byte>>4];result+=hex[byte&15];}cleanup();return result;
    }catch(...){cleanup();throw;}
}
void identity() {
    auto loader=GetModuleHandleW(L"UE4SS.dll");
    if(!loader || sha256(module_path(nullptr))!=game_hash || sha256(module_path(loader))!=loader_hash)
        throw std::runtime_error("CEF readiness requires the exact verified v0.05.1 game and loader.");
}
struct Read {
    template<class T> T operator()(std::uintptr_t address,T) const {
        T value{};SIZE_T count=0;
        if(!address || !ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<void*>(address),&value,sizeof(value),&count) || count!=sizeof(value))
            throw std::runtime_error("CEF readiness memory is unavailable.");
        return value;
    }
};
int ready(const Lua& lua) {
    if(lua.get_stack_size()!=0)throw std::runtime_error("CEF readiness takes no arguments.");
    const auto state=fanservice::cef::inspect(reinterpret_cast<std::uintptr_t>(GetModuleHandleW(nullptr)),Read{});
    lua.set_bool(state==fanservice::cef::State::running);lua.set_string(fanservice::cef::name(state));return 2;
}
}
extern "C" __declspec(dllexport) int luaopen_fanservice_cef_ready(lua_State* state) {
    try {
        identity();if(!state)return 0;
        HMODULE pinned=nullptr;
        if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&luaopen_fanservice_cef_ready),&pinned))return 0;
        Lua lua(state);lua.register_function("FanserviceCefReady",ready);return 0;
    }catch(const std::exception& problem){if(state){Lua lua(state);lua.set_string(problem.what(),std::strlen(problem.what()));return 1;}return 0;}
}
