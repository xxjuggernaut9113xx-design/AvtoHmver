#include "beat_guard.hpp"
#include <iostream>
#include <limits>
#include <stdexcept>
int main() {
    int count=0;auto check=[&](bool value){if(!value)throw std::runtime_error("Beat guard contract failed.");++count;};
    using D=fanservice::BeatDecision;fanservice::BeatLedger ledger;
    fanservice::GuardBeat first{0.2,3.2,0,0,0.5,1,1};
    check(ledger.observe(first)==D::accepted);
    auto padding=first;padding.padding=123;check(ledger.observe(padding)==D::duplicate);
    for(int field=0;field<5;++field) {
        auto changed=first;
        if(field==0)changed.fire+=0.1;if(field==1)changed.target+=0.1;if(field==2)changed.pattern=1;
        if(field==3)changed.interval+=0.1;if(field==4)changed.multiplier+=0.1f;
        check(ledger.observe(changed)==D::changed);
    }
    auto later=first;later.ordinal=3;later.fire=4;later.target=7;check(ledger.observe(later)==D::accepted);
    auto rewind=first;rewind.ordinal=2;check(ledger.observe(rewind)==D::accepted);
    check(ledger.observe(first)==D::duplicate);
    for(int field=0;field<11;++field) {
        auto bad=first;
        if(field==0)bad.fire=std::numeric_limits<double>::quiet_NaN();if(field==1)bad.target=std::numeric_limits<double>::infinity();
        if(field==2)bad.interval=0;if(field==3)bad.multiplier=-1;if(field==4)bad.ordinal=0;if(field==5)bad.ordinal=4097;
        if(field==6)bad.pattern=-1;if(field==7)bad.fire=-0.1;if(field==8)bad.target=86401;
        if(field==9)bad.interval=86401;if(field==10)bad.target=0.1;
        check(ledger.observe(bad)==D::malformed);
    }
    check(ledger.accepted==3 && ledger.changed==5 && ledger.malformed==11 && ledger.suppressed==18);
    fanservice::BeatLedger nextLease;check(nextLease.observe(first)==D::accepted);
    auto boundary=first;boundary.ordinal=4096;boundary.pattern=4095;check(nextLease.observe(boundary)==D::accepted);
    check(nextLease.observe(boundary)==D::duplicate);
    {
        fanservice::BeatLedger own,foreign;
        own.set_clock(0,false);check(own.observe(first)==D::deferred);
        check(own.accepted==0 && own.suppressed==0 && own.deferred==1);
        own.set_clock(100,false);check(own.observe(first)==D::deferred);
        own.set_clock(3.199,true);check(own.observe(first)==D::deferred);
        auto altered=first;altered.target=3.3;
        check(own.observe(altered)==D::deferred);
        own.set_clock(3.2,true);check(own.observe(first)==D::accepted);
        check(own.accepted==1 && own.suppressed==0 && own.deferred==4);
        own.set_clock(1,true);check(own.observe(first)==D::duplicate);
        own.set_clock(4,true);check(own.observe(first)==D::duplicate);
        check(own.observe(altered)==D::changed);
        check(own.accepted==1 && own.suppressed==3 && own.changed==1);
        own.set_clock(0,false);check(own.observe(altered)==D::changed);
        own.set_clock(0,false);auto invalid=first;invalid.ordinal=0;
        check(own.observe(invalid)==D::malformed);
        check(own.malformed==1 && own.suppressed==5 && own.deferred==4);
        for(double clock:{-1.0,86401.0,std::numeric_limits<double>::quiet_NaN(),std::numeric_limits<double>::infinity()}) {
            bool rejected=false;try{own.set_clock(clock,true);}catch(const std::runtime_error&){rejected=true;}
            check(rejected);
        }
        auto unseen=first;unseen.ordinal=2;check(own.observe(unseen)==D::deferred);
        check(foreign.accepted==0 && foreign.suppressed==0 && foreign.deferred==0);
        check(foreign.observe(first)==D::accepted);
        fanservice::BeatLedger fresh;check(fresh.observe(first)==D::accepted);
    }
    std::cout<<count<<" scoped beat deduplication contracts passed.\n";
}
