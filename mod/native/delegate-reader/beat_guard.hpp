#pragma once
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <map>
#include <stdexcept>

namespace fanservice {
struct GuardBeat {
    double fire=0,target=0;
    std::int32_t pattern=0,padding=0;
    double interval=0;
    std::int32_t ordinal=0;
    float multiplier=0;
};
static_assert(sizeof(GuardBeat)==40 && offsetof(GuardBeat,interval)==24 && offsetof(GuardBeat,ordinal)==32);
enum class BeatDecision { accepted,duplicate,malformed,changed,deferred };
class BeatLedger {
    std::map<std::int32_t,GuardBeat> delivered;
    bool clock_enabled=false,playing=false;
    double observed_position=0;
public:
    std::uint64_t accepted=0,suppressed=0,malformed=0,changed=0,deferred=0;
    void set_clock(double position,bool is_playing) {
        if(!std::isfinite(position) || position<0 || position>86400)
            throw std::runtime_error("Owned scratch decoder clock must be finite and within 0..86400 seconds.");
        observed_position=position;playing=is_playing;clock_enabled=true;
    }
    BeatDecision observe(const GuardBeat& event) {
        if(!std::isfinite(event.fire) || !std::isfinite(event.target) || !std::isfinite(event.interval)
            || !std::isfinite(event.multiplier) || event.fire<0 || event.target<event.fire || event.target>86400
            || event.interval<=0 || event.interval>86400 || event.pattern<0 || event.pattern>4095
            || event.ordinal<1 || event.ordinal>4096 || event.multiplier<0 || event.multiplier>1000) {
            ++malformed;++suppressed;return BeatDecision::malformed;
        }
        auto previous=delivered.find(event.ordinal);
        if(previous!=delivered.end()) {
            const auto& before=previous->second;
            ++suppressed;
            if(before.fire!=event.fire || before.target!=event.target || before.pattern!=event.pattern
                || before.interval!=event.interval || before.multiplier!=event.multiplier) {
                ++changed;return BeatDecision::changed;
            }
            return BeatDecision::duplicate;
        }
        if(clock_enabled && (!playing || event.target>observed_position)) {
            ++deferred;return BeatDecision::deferred;
        }
        delivered.emplace(event.ordinal,event);++accepted;return BeatDecision::accepted;
    }
};
}
