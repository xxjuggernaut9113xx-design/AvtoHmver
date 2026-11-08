#pragma once
#include <cstdint>
#include <stdexcept>

namespace fanservice::cef {
constexpr std::uintptr_t singleton_rva=0x0f1a5e88;
constexpr std::uintptr_t configuration_rva=0x0f1a5ee8;
constexpr std::uintptr_t runnable_vtable_rva=0x0dc38278;

// Exact v0.05.1 state, after FCefBrowserSingleton::InitInter returns success.
// INIT/BEGIN/RUN/STOP are native states, never inferred from elapsed time.
enum class State { unavailable, starting, running, stopped, disabled };
template<class Read> State inspect(std::uintptr_t image, Read read) {
    const auto configuration=read(image+configuration_rva,std::uintptr_t{});
    const auto singleton=read(image+singleton_rva,std::uintptr_t{});
    if(!configuration || !singleton) return State::unavailable;
    if(read(configuration+0x70,std::uint8_t{})!=0) return State::disabled;
    const auto runnable=read(singleton+0x20,std::uintptr_t{});
    if(!runnable) return State::starting;
    if(read(runnable,std::uintptr_t{})!=image+runnable_vtable_rva
        || read(runnable+8,std::uintptr_t{})!=singleton)
        throw std::runtime_error("CEF runnable identity is incompatible.");
    const auto state=read(runnable+0x10,std::int32_t{});
    if(state<0 || state>3) throw std::runtime_error("CEF runnable state is incompatible.");
    if(read(image+singleton_rva,std::uintptr_t{})!=singleton
        || read(singleton+0x20,std::uintptr_t{})!=runnable
        || read(image+configuration_rva,std::uintptr_t{})!=configuration)
        return State::unavailable;
    if(state==2) return State::running;
    if(state==3) return State::stopped;
    return State::starting;
}
inline const char* name(State state) {
    switch(state) {
    case State::unavailable:return "unavailable";
    case State::starting:return "starting";
    case State::running:return "running";
    case State::stopped:return "stopped";
    case State::disabled:return "disabled";
    }
    return "unavailable";
}
}
